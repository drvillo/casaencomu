import { createClient, type Client, type InStatement, type TransactionMode } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, isMember, projectDir, projectsOf } from "./control";
import { decode, WORDS } from "./entities";

/** The cookie the project switcher writes. Only a preference: membership is still checked. */
export const PROJECT_COOKIE = "casa_p";

/**
 * One SQLite file per project. `db` is a router, not a connection: every call finds the caller's
 * project first, so the connection *is* the tenant and no query can read another project's data
 * by forgetting a `WHERE`. Call sites are unchanged — `db.execute(...)` still reads the same.
 *
 * A project comes from, in order: an explicit `inProject()` scope (the background loops, the
 * scripts, the capture routes), or the request — the `x-user-email` the proxy set, plus the
 * project cookie, both checked against `memberships`. `docs/SCALE.md` § 4.
 */
const scope = new AsyncLocalStorage<string>();
const clients = new Map<string, { c: Client; ready: Promise<void> }>();

function clientFor(id: string) {
  let slot = clients.get(id);
  if (!slot) {
    mkdirSync(projectDir(id), { recursive: true });
    const c = createClient({ url: "file:" + join(projectDir(id), "casa.db") });
    // ponytail: unbounded map — one open file per active project. An LRU when that hurts.
    slot = {
      c,
      ready: c.executeMultiple("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000"),
    };
    clients.set(id, slot);
  }
  return slot;
}

/**
 * One render runs several queries at once, and each one resolves the project again. The lookup
 * *and* the creation share one promise per person, so three parallel queries that all find no
 * project cannot each create one — a second lookup issued before the first insert would still be
 * reading the old, empty answer when it returns.
 *
 * ponytail: in-process, because one container writes. Two containers would need the database to
 * settle it — a UNIQUE index on the first membership would do it.
 *
 * Exported because the project switcher needs the same answer, and because a test can drive it
 * without a request.
 */
const resolving = new Map<string, Promise<string>>();

export async function resolveProject(email: string | null, cookie: string | undefined): Promise<string> {
  if (!email) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (cookie && (await isMember(email, cookie))) return cookie;

  let pending = resolving.get(email);
  if (!pending) {
    pending = (async () => {
      const mine = await projectsOf(email);
      // ponytail: somebody with no project gets one, rather than an error page they cannot act
      // on. Invitations (the next issue) are the other way in; this is the way to start alone.
      return mine.length ? mine[0].id : await createProject("Mi búsqueda", email);
    })().finally(() => resolving.delete(email));
    resolving.set(email, pending);
  }
  return pending;
}

/** The project this call belongs to. Throws rather than guess: a wrong guess is a data leak. */
export async function currentProjectId(): Promise<string> {
  const scoped = scope.getStore();
  if (scoped) return scoped;

  let headers: Headers | null = null;
  let cookie: string | undefined;
  try {
    // ponytail: lazy import — this module loads in vitest and in scripts, with no request scope
    const next = await import("next/headers");
    headers = await next.headers();
    try {
      cookie = (await next.cookies()).get(PROJECT_COOKIE)?.value;
    } catch {
      // a route that can read headers but not cookies: the fallback below is still correct
    }
  } catch {
    headers = null;
  }
  // Inside a request the membership check is the only answer; it never falls back.
  if (headers) return resolveProject(headers.get("x-user-email"), cookie);
  // Outside one — a test, a script, a loop that forgot `inProject()` — there is no identity to
  // check, and there is no request to leak into either.
  return process.env.CASA_PROJECT ?? "default";
}

async function current(): Promise<Client> {
  const slot = clientFor(await currentProjectId());
  await slot.ready;
  return slot.c;
}

/** Runs `fn` against one project, for callers with no request: the loops, the scripts, captures. */
export const inProject = <T>(id: string, fn: () => Promise<T>): Promise<T> => scope.run(id, fn);

export const db = {
  execute: async (stmt: InStatement) => (await current()).execute(stmt),
  batch: async (stmts: InStatement[], mode?: TransactionMode) => (await current()).batch(stmts, mode),
  executeMultiple: async (sql: string) => (await current()).executeMultiple(sql),
  /**
   * A batch is enough when the statements are known in advance. Publishing an opinion is not:
   * it has to read the current version, decide whether anything changed, and only then write —
   * all of it one atomic step, or two devices publishing at once lose one person's work.
   * `"write"` begins IMMEDIATE, so the lock is taken before the read and cannot deadlock on an
   * upgrade. Always `commit()` or `rollback()`; an open handle holds the write lock.
   */
  transaction: async (mode: TransactionMode = "write") => (await current()).transaction(mode),
};

/**
 * Every migration after the version-1 bootstrap, in order. A fresh database and an existing one
 * run the same chain. Each one commits with its own `user_version` in a single write transaction,
 * so a half-applied step cannot exist. Never edit an applied entry; append a new one.
 */
type Migration = {
  version: number;
  owner: string;
  /** Plain statements, or a function that may read the database first to build them. */
  sql: InStatement[] | (() => Promise<InStatement[]>);
};

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    owner: "PIP-01 — import observations",
    sql: [
      // what the last observation returned: 'listing' | 'removed' | 'blocked' | 'unreadable'
      "ALTER TABLE sources ADD COLUMN last_check_outcome TEXT",
      // which fields that observation carried, so a refresh does not erase what it did not see
      "ALTER TABLE sources ADD COLUMN field_presence_json TEXT NOT NULL DEFAULT '{}'",
      // the photo URLs the listing offered, so a later refresh can fetch the ones that failed
      "ALTER TABLE sources ADD COLUMN photo_urls_json TEXT NOT NULL DEFAULT '[]'",
      // NULL on every row imported before this migration. Legacy URLs are never guessed.
      "ALTER TABLE photos ADD COLUMN source_url TEXT",
    ],
  },
  {
    version: 3,
    owner: "PIP-02 — availability is not a stage",
    sql: async () => [
      // Its own streak. Sharing `consecutive_failures` with blocked pages is finding F05.
      "ALTER TABLE sources ADD COLUMN consecutive_gone INTEGER NOT NULL DEFAULT 0",
      // Advances only when a member changes the stage, never when a source is refreshed.
      "ALTER TABLE properties ADD COLUMN stage_version INTEGER NOT NULL DEFAULT 1",
      ...(await stageRepairStatements()),
    ],
  },
  {
    version: 4,
    owner: "issue #111 — a link is accepted first and read afterwards",
    sql: [
      // The last observation, in the shape the fill layers read: text, og, title, status. Capped
      // in `save.ts`. It is what lets a later pass retry without asking the person for the page
      // again — the only copy there is of a page a server can never fetch.
      "ALTER TABLE sources ADD COLUMN raw_json TEXT",
      // Which layer produced each field: the portal, the AI reading the page, or the AI deducing.
      "ALTER TABLE sources ADD COLUMN field_origin_json TEXT NOT NULL DEFAULT '{}'",
      // NULL = the AI layers have not run on the observation currently stored. A new observation
      // sets it back to NULL, which is what puts the source back in the queue.
      "ALTER TABLE sources ADD COLUMN enriched_at TEXT",
      // 0 while nothing has been read from the advertisement yet: the row exists, the link is
      // safe, and the title is a placeholder built from the URL. It never goes back to 0.
      "ALTER TABLE properties ADD COLUMN filled INTEGER NOT NULL DEFAULT 1",
    ],
  },
  {
    version: 5,
    owner: "issue #136 — notifications, and a list of what you have not looked at",
    sql: [
      // One row per person per home, written the first time they open its page. «Por revisar» is
      // the absence of a row, so nothing has to be cleared and nothing can drift out of date.
      `CREATE TABLE IF NOT EXISTS reviews (
         property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
         user_id TEXT NOT NULL REFERENCES users(id), reviewed_at TEXT NOT NULL,
         PRIMARY KEY (property_id, user_id))`,
    ],
  },
  {
    version: 6,
    owner: "issue #139 — opinions, private drafts and withdrawal (PIP-09)",
    sql: [
      // One opinion per person per home. `reviews` was taken by version 5 for «has this person
      // looked at it», and the app says «opinión» wherever a person is asked, so this is
      // `opinions`. Everything except the stance is optional: a stance alone is a whole opinion.
      `CREATE TABLE IF NOT EXISTS opinions (
         property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
         user_id TEXT NOT NULL REFERENCES users(id),
         stance TEXT CHECK (stance IN ('me_interesa', 'dudas', 'no_me_encaja')),
         reasoning TEXT NOT NULL DEFAULT '',
         blocker INTEGER NOT NULL DEFAULT 0,
         basis TEXT CHECK (basis IN ('listing', 'visit')),
         withdrawn INTEGER NOT NULL DEFAULT 0,
         version INTEGER NOT NULL DEFAULT 1,
         published_at TEXT NOT NULL, updated_at TEXT NOT NULL,
         PRIMARY KEY (property_id, user_id))`,
      // The private half. The row outlives its payload: publishing empties `payload_json` and
      // advances `revision`, and that number is what rejects a save typed before the publication
      // and delivered after it. `base_version` is the publication the draft was written against.
      `CREATE TABLE IF NOT EXISTS opinion_drafts (
         property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
         user_id TEXT NOT NULL REFERENCES users(id),
         payload_json TEXT, revision INTEGER NOT NULL DEFAULT 0,
         base_version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
         PRIMARY KEY (property_id, user_id))`,
      // Everyone who ever scored a home already holds an opinion; it just had no words. Give it a
      // row so the count of people who have opined is one query, and so a later edit has
      // something to version. Stance stays NULL: they were never asked, and a score is not a
      // stance. `published_at` is their own last rating, never today.
      `INSERT INTO opinions (property_id, user_id, stance, reasoning, blocker, basis, withdrawn, version, published_at, updated_at)
         SELECT property_id, user_id, NULL, '', 0, NULL, 0, 1, MAX(updated_at), MAX(updated_at)
         FROM ratings GROUP BY property_id, user_id
         ON CONFLICT DO NOTHING`,
    ],
  },
  {
    version: 7,
    owner: "issue #146 — a conversation with replies (PIP-11)",
    sql: async () => {
      // Five columns on `comments`. Asked for by name rather than added blind, because
      // `ALTER TABLE ADD COLUMN` is the one migration step that cannot be written to run twice,
      // and a chain replayed from an earlier version is a thing that happens (see migrate.test).
      const held = new Set((await db.execute("PRAGMA table_info(comments)")).rows.map((r) => String(r.name)));
      const columns: [string, string][] = [
        // A reply hangs off a root comment. `parent_id` on a reply is always a root: one level is
        // the whole shape, and it is enforced where replies are written, not by a CHECK that
        // cannot see the other row.
        ["parent_id", "TEXT NULL REFERENCES comments(id)"],
        // Which published opinion this comment answers, by its author. The pair
        // (property_id, opinion_user_id) is what makes a cross-property reference impossible.
        ["opinion_user_id", "TEXT NULL REFERENCES users(id)"],
        // NULL means never edited, so «editado» is never shown for a comment nobody touched.
        ["updated_at", "TEXT NULL"],
        // A removed comment keeps its row: its replies still hang off it and still have to read
        // as answers to something. The body is cleared at the same time.
        ["deleted_at", "TEXT NULL"],
        ["version", "INTEGER NOT NULL DEFAULT 1"],
      ];
      return [
        ...columns.filter(([name]) => !held.has(name)).map(([name, type]) => `ALTER TABLE comments ADD COLUMN ${name} ${type}`),
        // Every comment event ever written carried a copy of the words. That copy outlives the
        // comment, so removing one would leave it readable in the activity feed for good. Take the
        // text out of the history and stop writing it (V21).
        "UPDATE events SET payload_json = json_remove(payload_json, '$.body') WHERE kind = 'comment' AND payload_json IS NOT NULL",
      ];
    },
  },
  {
    version: 8,
    owner: "issue #143 — the words a portal wrote, not the entities it wrote them with",
    /**
     * `decode()` knew six entity names, so every accent an Idealista agency wrote as `&oacute;`
     * was stored as those nine characters. 19 of the family's 24 descriptions read that way.
     *
     * The extractor is fixed, but a corrected extractor never comes back to a row it has already
     * read: `filled = 1` and the recheck only looks for what changed. So the repair is here, once,
     * over the columns a page's own words reach.
     */
    sql: async () => {
      const cols = WORDS.join(", ");
      const { rows } = await db.execute(
        `SELECT id, ${cols} FROM properties WHERE ${WORDS.map((c) => `${c} GLOB '*&*;*'`).join(" OR ")}`,
      );
      const stmts: InStatement[] = [];
      for (const r of rows) {
        const now = WORDS.map((c) => (r[c] == null ? null : decode(String(r[c]))));
        // A row whose `&` was never an entity — "Pisos & Casas" — matches the GLOB and decodes to
        // itself. Writing it would be a no-op with a cost, so it is not written.
        if (WORDS.every((c, i) => (r[c] ?? null) === now[i])) continue;
        stmts.push({
          sql: `UPDATE properties SET ${WORDS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
          args: [...now, String(r.id)],
        });
      }
      if (stmts.length) console.log(`[db] decoding the entities in ${stmts.length} listing(s)`);
      return stmts;
    },
  },
  {
    version: 9,
    owner: "issue #151 — activity that stays unread until you have read it (PIP-13)",
    sql: [
      `CREATE TABLE IF NOT EXISTS event_reads (
         user_id TEXT NOT NULL REFERENCES users(id),
         event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
         read_at TEXT NOT NULL,
         PRIMARY KEY (user_id, event_id))`,
      // What each person had already seen under the old single timestamp, written down before it
      // stops meaning anything here. Without this everybody opens the page to a wall of «nuevo»
      // over lines they read last week — and `last_seen_at` keeps its own job, the bell.
      `INSERT OR IGNORE INTO event_reads (user_id, event_id, read_at)
       SELECT u.id, e.id, u.last_seen_at FROM users u JOIN events e
        WHERE u.last_seen_at IS NOT NULL AND e.created_at <= u.last_seen_at`,
      "CREATE INDEX IF NOT EXISTS events_newest ON events(created_at DESC, id DESC)",
    ],
  },
  {
    version: 10,
    owner: "readiness — retryable enrichment and observation ownership",
    sql: [
      "ALTER TABLE sources ADD COLUMN observation_version INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE sources ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE sources ADD COLUMN enrichment_retry_at TEXT",
      "ALTER TABLE sources ADD COLUMN enrichment_token TEXT",
      "ALTER TABLE sources ADD COLUMN enrichment_lease_until TEXT",
    ],
  },
  {
    version: 11,
    owner: "visits — outreach",
    sql: [
      `CREATE TABLE visit_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'span')),
  weekday INTEGER,
  start_min INTEGER,
  end_min INTEGER,
  start_at TEXT,
  end_at TEXT,
  zone TEXT NOT NULL,
  CHECK (
    (kind = 'weekly'
      AND weekday BETWEEN 1 AND 7
      AND start_min BETWEEN 0 AND 1439
      AND end_min BETWEEN 1 AND 1440
      AND start_min < end_min
      AND start_at IS NULL
      AND end_at IS NULL)
    OR
    (kind = 'span'
      AND weekday IS NULL
      AND start_min IS NULL
      AND end_min IS NULL
      AND start_at IS NOT NULL
      AND end_at IS NOT NULL
      AND start_at < end_at)
  )
)`,
      "CREATE INDEX visit_rules_user ON visit_rules(user_id)",
      `CREATE TABLE visit_cases (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  contact_email TEXT NOT NULL CHECK (length(contact_email) <= 200),
  status TEXT NOT NULL CHECK (status IN (
    'por_contactar', 'contactado', 'esperando_respuesta', 'no_sigue',
    'visita_propuesta', 'visita_confirmada', 'visitada', 'rechazada')),
  reply_token TEXT NOT NULL UNIQUE,
  confirmed_start TEXT,
  confirmed_end TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  note_user_id TEXT REFERENCES users(id),
  note_at TEXT,
  attention INTEGER NOT NULL DEFAULT 0 CHECK (attention IN (0, 1)),
  case_version INTEGER NOT NULL DEFAULT 1,
  cycle INTEGER NOT NULL DEFAULT 1 CHECK (cycle >= 1),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status IN ('visita_confirmada', 'visitada')
      AND confirmed_start IS NOT NULL
      AND confirmed_end IS NOT NULL
      AND confirmed_start < confirmed_end)
    OR
    (status NOT IN ('visita_confirmada', 'visitada')
      AND confirmed_start IS NULL
      AND confirmed_end IS NULL)
  )
)`,
      `CREATE TABLE visit_messages (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES visit_cases(property_id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  purpose TEXT NOT NULL CHECK (purpose IN ('ask', 'confirm', 'counter', 'reply')),
  provider_message_id TEXT,
  idempotency_key TEXT,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  body TEXT NOT NULL CHECK (length(body) <= 100000),
  parsed TEXT CHECK (parsed IS NULL OR parsed IN ('yes', 'no', 'unknown')),
  ranges_json TEXT,
  send_state TEXT NOT NULL CHECK (send_state IN ('received', 'unsent', 'sent')),
  created_at TEXT NOT NULL,
  CHECK (
    (direction = 'in'
      AND purpose = 'reply'
      AND send_state = 'received'
      AND provider_message_id IS NOT NULL
      AND idempotency_key IS NULL)
    OR
    (direction = 'out'
      AND purpose IN ('ask', 'confirm', 'counter')
      AND send_state IN ('unsent', 'sent')
      AND idempotency_key IS NOT NULL)
  )
)`,
      `CREATE UNIQUE INDEX visit_messages_provider
  ON visit_messages(provider_message_id) WHERE provider_message_id IS NOT NULL`,
      `CREATE UNIQUE INDEX visit_messages_key
  ON visit_messages(idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE UNIQUE INDEX visit_messages_rfc
  ON visit_messages(rfc_message_id) WHERE rfc_message_id IS NOT NULL`,
    ],
  },
];

/**
 * `no_disponible` was a stage until this migration, so a recheck wrote it over whatever the
 * family had decided and their decision was gone. It is still in `events`: only a member ever
 * wrote a `stage_change`, because the recheck changed the column directly without one. Take the
 * last one they wrote; if there is none we genuinely do not know what they wanted, so it goes
 * back into the queue as `revisando` rather than being guessed into a decision.
 *
 * Exported so it can be tested against a database that actually has such rows — the migration
 * itself can only run once, on a database this repair has never touched.
 */
export async function stageRepairStatements(): Promise<InStatement[]> {
  const { rows } = await db.execute(
    `SELECT p.id, (
       SELECT json_extract(e.payload_json, '$.to') FROM events e
       WHERE e.property_id = p.id AND e.kind = 'stage_change'
         AND json_extract(e.payload_json, '$.to') IN
             ('nueva', 'revisando', 'preseleccionada', 'visita_prevista', 'descartada')
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1
     ) AS restored
     FROM properties p WHERE p.stage = 'no_disponible'`,
  );

  const at = new Date().toISOString();
  const stmts: InStatement[] = [];
  for (const r of rows) {
    const id = String(r.id);
    const restored = typeof r.restored === "string" ? r.restored : "revisando";
    stmts.push(
      { sql: "UPDATE properties SET stage = ? WHERE id = ?", args: [restored, id] },
      {
        sql: `INSERT INTO events (id, property_id, kind, payload_json, actor_id, created_at)
              VALUES (?, ?, 'stage_change', ?, NULL, ?)`,
        args: [
          randomUUID(),
          id,
          JSON.stringify({
            from: "no_disponible",
            to: restored,
            nota: r.restored
              ? "Etapa restaurada: la disponibilidad ya no cambia la etapa"
              : "Etapa restaurada a Revisando: no había ninguna etapa anterior guardada",
          }),
          at,
        ],
      },
    );
  }
  if (rows.length) console.log(`[db] restored ${rows.length} stage(s) overwritten by a recheck`);
  return stmts;
}

/** Version 1 is `schema.sql`, all of it `IF NOT EXISTS`; `MIGRATIONS` carries every change after it. */
export async function applySchema() {
  // ponytail: cwd-relative read; Next's file tracing copies schema.sql into .next/standalone
  await db.executeMultiple(readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8"));
  const at = async () => Number((await db.execute("PRAGMA user_version")).rows[0][0]);
  if ((await at()) === 0) await db.execute("PRAGMA user_version = 1");

  for (const m of MIGRATIONS) {
    if ((await at()) >= m.version) continue;
    // A failure here throws and start-up stops: serving on a half-migrated database is worse.
    const stmts = typeof m.sql === "function" ? await m.sql() : m.sql;
    await db.batch([...stmts, `PRAGMA user_version = ${m.version}`], "write");
    console.log(`[db] migrated to version ${m.version} (${m.owner})`);
  }
}
