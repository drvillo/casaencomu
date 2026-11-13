import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalFacts, factsHash } from "./changes";
import { extract } from "./extract";
import {
  propertyId,
  providerMessageId,
  replyToken,
  userId,
  VISIT_STATUSES,
  wallInterval,
  weeklyRule,
  zone,
} from "./visit-plan";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "casa-visits-"));
process.env.MAIL_REPLY_DOMAIN = "visitas.example";
const { db, applySchema } = await import("./db");
const { control, controlReady } = await import("./control");
const { act } = await import("./visit");
const { runRechecks } = await import("./recheck");

const AT = "2026-11-01T00:00:00.000Z";
const USER = randomUUID();
const madrid = zone("Europe/Madrid");
if (!madrid.ok) throw new Error("zone");
const NOW = new Date("2026-11-17T08:00:00.000Z");
const fixture = readFileSync(new URL("./__fixtures__/fotocasa.html", import.meta.url), "utf8");
const FOTOCASA_URL = "https://www.fotocasa.es/es/comprar/vivienda/barcelona-capital/some-slug/190311653/d";
const listing = extract({ url: FOTOCASA_URL, html: fixture })!;

const pid = (id: string) => {
  const parsed = propertyId(id);
  if (!parsed.ok) throw new Error("id");
  return parsed.id;
};

const rows = async (sql: string, ...args: (string | number)[]) => (await db.execute({ sql, args })).rows;

beforeAll(async () => {
  await applySchema();
  await controlReady;
  await control.execute({
    sql: "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES ('default', 'Prueba', ?)",
    args: [AT],
  });
  await control.execute({
    sql: "INSERT OR IGNORE INTO memberships (project_id, email, created_at, role) VALUES ('default', 'ana@example.com', ?, 'owner')",
    args: [AT],
  });
  await db.execute({
    sql: "INSERT INTO users (id, email, name, capture_token, created_at) VALUES (?, 'ana@example.com', 'Ana', ?, ?)",
    args: [USER, randomUUID(), AT],
  });
});

beforeEach(async () => {
  await db.execute("DELETE FROM properties");
  await db.execute("DELETE FROM visit_rules");
});

async function home(stage: string) {
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO properties (id, title, stage, price_eur, neighborhood, rooms, area_m2, created_at, updated_at)
          VALUES (?, 'Piso del ejemplo', ?, 250000, 'Eixample', 3, 80, ?, ?)`,
    args: [id, stage, AT, AT],
  });
  return id;
}

async function openCase(property: string, token = "ab".repeat(32)) {
  await db.execute({
    sql: `INSERT INTO visit_cases (
            property_id, contact_email, status, reply_token, note, attention, case_version, cycle,
            created_by, created_at, updated_at
          ) VALUES (?, 'anunciante@example.com', 'esperando_respuesta', ?, '', 0, 1, 1, ?, ?, ?)`,
    args: [property, token, USER, AT, AT],
  });
  return token;
}

function mailer(send: (message: { text: string; idempotencyKey: string }) => Promise<{ providerMessageId: string }>) {
  const calls: { text: string; idempotencyKey: string }[] = [];
  return {
    calls,
    mail: {
      async send(message: { text: string; idempotencyKey: string }) {
        calls.push({ text: message.text, idempotencyKey: message.idempotencyKey });
        return send(message);
      },
    },
  };
}

function recording() {
  return mailer(async (message) => ({ providerMessageId: `log:${message.idempotencyKey}` }));
}

async function wednesday() {
  const rule = weeklyRule({ weekday: 3, startHour: 10, startMinute: 0, endHour: 12, endMinute: 0, zone: madrid.zone });
  if (!rule.ok) throw new Error("rule");
  await act({ type: "save_rules", userId: userId(USER), rules: [rule.rule] });
}

function reply(token: string, provider = "reply-1") {
  return {
    type: "ingest" as const,
    token: replyToken(token),
    providerMessageId: providerMessageId(provider),
    text: "Podemos el 18 de noviembre de 2026 a las 10:00.",
    inReplyTo: null,
  };
}

describe("ingest", () => {
  it("stores one inbound row and sends one confirmation for the same provider id", async () => {
    const id = await home("revisando");
    const token = await openCase(id);
    await wednesday();
    const sent = recording();
    const deps = { mail: sent.mail, now: () => NOW };
    await act(reply(token), deps);
    await act(reply(token), deps);
    const messages = await rows(
      "SELECT direction, purpose, send_state FROM visit_messages WHERE property_id = ?",
      id,
    );
    expect(messages.filter((row) => row.direction === "in")).toHaveLength(1);
    expect(sent.calls.filter((call) => call.text.includes("Podemos visitar"))).toHaveLength(1);
    expect(messages.filter((row) => row.purpose === "confirm")).toHaveLength(1);
  });

  it("leaves the outbound row unsent when the mailer throws, and a later deliver sends it once", async () => {
    const id = await home("revisando");
    const token = await openCase(id);
    await wednesday();
    const sent = mailer(async () => {
      throw new Error("down");
    });
    await expect(act(reply(token), { mail: sent.mail, now: () => NOW })).rejects.toThrow("down");
    expect(String((await rows("SELECT send_state FROM visit_messages WHERE property_id = ? AND direction = 'out'", id))[0].send_state)).toBe(
      "unsent",
    );
    const again = recording();
    await act({ type: "deliver" }, { mail: again.mail, now: () => NOW });
    expect(again.calls).toHaveLength(1);
    expect(String((await rows("SELECT send_state FROM visit_messages WHERE property_id = ? AND direction = 'out'", id))[0].send_state)).toBe(
      "sent",
    );
    await act({ type: "deliver" }, { mail: again.mail, now: () => NOW });
    expect(again.calls).toHaveLength(1);
  });

  it("books a slot from revisando into visita_prevista", async () => {
    const id = await home("revisando");
    await openCase(id);
    await wednesday();
    const sent = recording();
    await act(reply("ab".repeat(32)), { mail: sent.mail, now: () => NOW });
    expect(String((await rows("SELECT stage FROM properties WHERE id = ?", id))[0].stage)).toBe("visita_prevista");
    expect(String((await rows("SELECT status FROM visit_cases WHERE property_id = ?", id))[0].status)).toBe("visita_confirmada");
  });

  it("keeps a discarded home discarded and still stores the visit", async () => {
    const id = await home("descartada");
    await openCase(id, "cd".repeat(32));
    await wednesday();
    await act(reply("cd".repeat(32), "reply-2"), { mail: recording().mail, now: () => NOW });
    expect(String((await rows("SELECT stage FROM properties WHERE id = ?", id))[0].stage)).toBe("descartada");
    expect(String((await rows("SELECT status FROM visit_cases WHERE property_id = ?", id))[0].status)).toBe("visita_confirmada");
  });
});

describe("confirm and notes", () => {
  it("stores a hand confirm the picker would not choose and queues one letter", async () => {
    const id = await home("revisando");
    await openCase(id);
    const slot = wallInterval({
      year: 2026,
      month: 11,
      day: 20,
      startHour: 10,
      startMinute: 0,
      endHour: 10,
      endMinute: 30,
      zone: madrid.zone,
    });
    if (!slot.ok) throw new Error("slot");
    const sent = recording();
    const result = await act(
      {
        type: "confirm",
        propertyId: pid(id),
        actorId: userId(USER),
        slot: slot.slot,
        stageVersion: 1,
        caseVersion: 1,
      },
      { mail: sent.mail, now: () => new Date("2026-11-18T08:00:00.000Z") },
    );
    expect(result.ok).toBe(true);
    expect(String((await rows("SELECT status FROM visit_cases WHERE property_id = ?", id))[0].status)).toBe("visita_confirmada");
    expect(sent.calls.filter((call) => call.text.includes("hora de Madrid"))).toHaveLength(1);
  });

  it("saves nothing when the hand confirm version is stale", async () => {
    const id = await home("revisando");
    await openCase(id);
    const slot = wallInterval({
      year: 2026,
      month: 11,
      day: 20,
      startHour: 11,
      startMinute: 0,
      endHour: 11,
      endMinute: 30,
      zone: madrid.zone,
    });
    if (!slot.ok) throw new Error("slot");
    const result = await act(
      {
        type: "confirm",
        propertyId: pid(id),
        actorId: userId(USER),
        slot: slot.slot,
        stageVersion: 9,
        caseVersion: 1,
      },
      { mail: recording().mail, now: () => new Date("2026-11-18T08:00:00.000Z") },
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(String((await rows("SELECT stage FROM properties WHERE id = ?", id))[0].stage)).toBe("revisando");
    expect(String((await rows("SELECT status FROM visit_cases WHERE property_id = ?", id))[0].status)).toBe("esperando_respuesta");
    expect(await rows("SELECT id FROM visit_messages WHERE property_id = ?", id)).toHaveLength(0);
  });

  it("keeps the note on the case and out of the event payload", async () => {
    const id = await home("revisando");
    await openCase(id);
    const result = await act({
      type: "note",
      propertyId: pid(id),
      actorId: userId(USER),
      text: "Nota secreta 42",
      caseVersion: 1,
    });
    expect(result.ok).toBe(true);
    expect(String((await rows("SELECT note FROM visit_cases WHERE property_id = ?", id))[0].note)).toBe("Nota secreta 42");
    const events = await rows("SELECT payload_json FROM events WHERE property_id = ?", id);
    for (const event of events) expect(String(event.payload_json)).not.toContain("Nota secreta 42");
  });
});

describe("recheck", () => {
  it("updates a source without moving the stage or the visit", async () => {
    const property = randomUUID();
    const t0 = new Date(Date.now() - 72 * 3_600_000).toISOString();
    const prev = canonicalFacts(listing);
    await db.batch(
      [
        {
          sql: "INSERT INTO properties (id, title, stage, price_eur, rooms, created_at, updated_at) VALUES (?, ?, 'preseleccionada', ?, ?, ?, ?)",
          args: [property, listing.title, listing.price_eur ?? null, listing.rooms ?? null, t0, t0],
        },
        {
          sql: `INSERT INTO sources (id, property_id, portal, portal_ref, url_normalized, url_original, via, facts_json, facts_hash,
                first_seen_at, last_checked_at, last_ok_at) VALUES (?, ?, 'fotocasa', '190311653', ?, ?, 'paste', ?, ?, ?, ?, ?)`,
          args: [randomUUID(), property, FOTOCASA_URL.replace("www.", ""), FOTOCASA_URL, JSON.stringify(prev), factsHash(prev), t0, t0, t0],
        },
      ],
      "write",
    );
    await openCase(property, "ef".repeat(32));
    const edited = fixture.replaceAll("1644999", "1600000");
    await runRechecks({ spacingMs: 0, fetchPage: async () => ({ status: 200, finalUrl: FOTOCASA_URL, html: edited }) });
    expect(String((await rows("SELECT stage FROM properties WHERE id = ?", property))[0].stage)).toBe("preseleccionada");
    expect(String((await rows("SELECT status FROM visit_cases WHERE property_id = ?", property))[0].status)).toBe(
      "esperando_respuesta",
    );
  });
});

describe("the visit writer stays in one place", () => {
  it("keeps recheck and enrichment off the visit tables", () => {
    expect(readFileSync(new URL("./recheck.ts", import.meta.url), "utf8")).not.toContain("visit_cases");
    expect(readFileSync(new URL("./enrich.ts", import.meta.url), "utf8")).not.toContain("visit.ts");
    const dbSrc = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const sql = dbSrc.slice(dbSrc.indexOf('owner: "visits — outreach"'), dbSrc.indexOf('owner: "visits — outreach"') + 2500);
    for (const status of VISIT_STATUSES) expect(sql).toContain(`'${status}'`);
  });

  it("does not let a page call the pure planner, and the inbound route ignores the user header", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
      });
    for (const file of walk(join(process.cwd(), "src/app"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\b(parseReply|pickSlot|nextVisitStatus)\b/);
    }
    const route = join(process.cwd(), "src/app/api/visitas/entrada/route.ts");
    if (existsSync(route)) expect(readFileSync(route, "utf8")).not.toContain("x-user-email");
  });
});
