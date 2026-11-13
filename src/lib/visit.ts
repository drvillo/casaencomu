import { randomBytes, randomUUID } from "node:crypto";
import type { Transaction } from "@libsql/client";
import { membersOf } from "./control";
import { currentProjectId, db } from "./db";
import { type Stage } from "./listing";
import { commitStage } from "./stage";
import {
  ADVERTISER_ZONE,
  INBOUND_CHARS,
  NOTE_MAX,
  VISIT_STATUSES,
  instant,
  nextVisitStatus,
  parseReply,
  pickSlot,
  type Email,
  type FreeRule,
  type Instant,
  type Interval,
  type Pick,
  type PropertyId,
  type ProviderMessageId,
  type ReplyToken,
  type UserId,
  type VisitStatus,
  type Weekday,
} from "./visit-plan";

export {
  ADVERTISER_ZONE,
  MANUAL_TARGETS,
  NOTE_MAX,
  VISIT_LABELS,
  VISIT_STATUSES,
  emailAddress,
  instant,
  interval,
  propertyId,
  providerMessageId,
  replyToken,
  spanRule,
  userId,
  wallInterval,
  weeklyRule,
  zone,
  type Email,
  type FreeRule,
  type Instant,
  type Interval,
  type PropertyId,
  type ReplyToken,
  type UserId,
  type VisitStatus,
  type Zone,
} from "./visit-plan";

export type VisitCommand =
  | { type: "save_rules"; userId: UserId; rules: readonly FreeRule[] }
  | {
      type: "open";
      propertyId: PropertyId;
      contactEmail: Email;
      actorId: UserId;
      send: boolean;
      caseVersion: number | null;
    }
  | {
      type: "ingest";
      token: ReplyToken;
      providerMessageId: ProviderMessageId;
      text: string;
      inReplyTo: string | null;
    }
  | {
      type: "confirm";
      propertyId: PropertyId;
      actorId: UserId;
      slot: Interval;
      stageVersion: number;
      caseVersion: number;
    }
  | { type: "move"; propertyId: PropertyId; actorId: UserId; to: VisitStatus; caseVersion: number }
  | { type: "note"; propertyId: PropertyId; actorId: UserId; text: string; caseVersion: number }
  | { type: "deliver" };

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  purpose: "ask" | "confirm" | "counter" | "reply";
  body: string;
  at: Instant;
  sendState: "received" | "unsent" | "sent";
  ranges: Interval[];
};

export type BoardRow = {
  propertyId: PropertyId;
  title: string;
  priceEur: number | null;
  neighborhood: string | null;
  rooms: number | null;
  areaM2: number | null;
  stage: Stage;
  stageVersion: number;
  status: VisitStatus;
  attention: boolean;
  confirmed: Interval | null;
  contactEmail: Email;
  caseVersion: number;
};

export type VisitCaseView = BoardRow & {
  note: string;
  messages: ThreadMessage[];
};

export type VisitResult =
  | { ok: true; kind: "case"; case: VisitCaseView }
  | { ok: true; kind: "rules"; rules: FreeRule[] }
  | { ok: true; kind: "delivered"; sent: number }
  | { ok: false; reason: "missing" | "conflict" | "bad_move" | "no_case" | "same" };

export type Mailer = {
  send(mail: {
    to: Email;
    from: string;
    replyTo: string;
    subject: string;
    text: string;
    idempotencyKey: string;
    messageId: string;
  }): Promise<{ providerMessageId: string }>;
};

export type VisitDeps = {
  mail: Mailer;
  now: () => Date;
};

type Row = Record<string, unknown>;
type Wrote =
  | { commit: boolean; deliver: boolean; propertyId: PropertyId }
  | { commit: boolean; deliver: boolean; result: VisitResult };

const FROM_NAME = "Casa En Comú";

function replyAddress(projectId: string, token: string, domain: string) {
  return `visitas+${projectId}.${token}@${domain}`;
}

function outboxKey(
  input:
    | { purpose: "ask"; propertyId: PropertyId; cycle: number }
    | { purpose: "confirm"; propertyId: PropertyId; providerMessageId: string }
    | { purpose: "counter"; propertyId: PropertyId; providerMessageId: string }
    | { purpose: "hand"; propertyId: PropertyId; slot: Interval },
) {
  switch (input.purpose) {
    case "ask":
      return `ask:${input.propertyId}:${input.cycle}`;
    case "confirm":
      return `confirm:${input.propertyId}:${input.providerMessageId}`;
    case "counter":
      return `counter:${input.propertyId}:${input.providerMessageId}`;
    case "hand":
      return `hand:${input.propertyId}:${input.slot.start}:${input.slot.end}`;
  }
}

function rfcMessageId(idempotencyKey: string, domain: string) {
  return `<${idempotencyKey.replace(/[^A-Za-z0-9._-]/g, ".")}@${domain}>`;
}

function shortTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

function askLetter(input: { title: string; ref: string }) {
  return {
    subject: `¿Sigue disponible? ${shortTitle(input.title)}`,
    text: [
      "Buenos días,",
      "",
      `Nos interesa el anuncio «${input.title}».`,
      "¿Sigue disponible?",
      "¿Qué días y horas podemos visitarlo?",
      "",
      "Gracias.",
      `Ref: ${input.ref}`,
    ].join("\n"),
  };
}

function confirmLetter(input: { title: string; slot: Interval; ref: string }) {
  const when = new Intl.DateTimeFormat("es-ES", {
    timeZone: ADVERTISER_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = when.format(new Date(input.slot.start));
  const end = when.format(new Date(input.slot.end));
  return {
    subject: `Visita confirmada: ${shortTitle(input.title)}`,
    text: [
      "Buenos días,",
      "",
      `Gracias. Podemos visitar «${input.title}» el ${start} a ${end} (hora de Madrid).`,
      "",
      "Hasta entonces.",
      `Ref: ${input.ref}`,
    ].join("\n"),
  };
}

function counterLetter(input: { title: string; ref: string }) {
  return {
    subject: `Otras horas para visitar ${shortTitle(input.title)}`,
    text: [
      "Buenos días,",
      "",
      `Gracias por las horas para «${input.title}». Esas no nos van bien.`,
      "¿Nos puede proponer otras?",
      "",
      "Gracias.",
      `Ref: ${input.ref}`,
    ].join("\n"),
  };
}

function subjectFor(purpose: string, title: string, slot: Interval | null) {
  const ref = "x";
  if (purpose === "confirm") {
    return confirmLetter({
      title,
      slot: slot ?? { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-01-01T00:30:00.000Z") },
      ref,
    }).subject;
  }
  if (purpose === "counter") return counterLetter({ title, ref }).subject;
  return askLetter({ title, ref }).subject;
}

function replyDomain() {
  const domain = process.env.MAIL_REPLY_DOMAIN?.trim() ?? "";
  return domain || null;
}

function num(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function asStatus(value: unknown): VisitStatus {
  const status = String(value);
  return (VISIT_STATUSES as readonly string[]).includes(status) ? (status as VisitStatus) : "por_contactar";
}

function ruleFrom(row: Row): FreeRule | null {
  const parsed = row.zone;
  if (typeof parsed !== "string") return null;
  const zoneName = parsed as FreeRule["zone"];
  if (row.kind === "weekly") {
    const weekday = Number(row.weekday);
    if (weekday < 1 || weekday > 7) return null;
    return {
      kind: "weekly",
      weekday: weekday as Weekday,
      startMin: Number(row.start_min),
      endMin: Number(row.end_min),
      zone: zoneName,
    };
  }
  if (row.kind === "span" && typeof row.start_at === "string" && typeof row.end_at === "string") {
    return { kind: "span", start: instant(row.start_at), end: instant(row.end_at), zone: zoneName };
  }
  return null;
}

function rangesOf(value: unknown): Interval[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as { start?: unknown; end?: unknown }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((range) =>
      typeof range.start === "string" && typeof range.end === "string"
        ? [{ start: instant(range.start), end: instant(range.end) }]
        : [],
    );
  } catch {
    return [];
  }
}

function stop(reason: "missing" | "conflict" | "bad_move" | "no_case" | "same"): Wrote {
  return { commit: false, deliver: false, result: { ok: false, reason } };
}

async function rulesFor(tx: Transaction, user: string) {
  const rows = await tx.execute({
    sql: "SELECT kind, weekday, start_min, end_min, start_at, end_at, zone FROM visit_rules WHERE user_id = ? ORDER BY rowid",
    args: [user],
  });
  return rows.rows.flatMap((row) => {
    const rule = ruleFrom(row as Row);
    return rule ? [rule] : [];
  });
}

async function memberRules(tx: Transaction) {
  const members = await membersOf(await currentProjectId());
  const wanted = new Set(members.map((member) => member.email.trim().toLowerCase()));
  const users = await tx.execute("SELECT id, email FROM users");
  const lists: FreeRule[][] = [];
  for (const user of users.rows) {
    if (!wanted.has(String(user.email).trim().toLowerCase())) continue;
    lists.push(await rulesFor(tx, String(user.id)));
  }
  return lists;
}

async function record(tx: Transaction, propertyId: string, kind: string, payload: unknown, actor: string | null, at: string) {
  await tx.execute({
    sql: "INSERT INTO events (id, property_id, kind, payload_json, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), propertyId, kind, JSON.stringify(payload), actor, at],
  });
}

async function hasKey(tx: Transaction, key: string) {
  const found = await tx.execute({ sql: "SELECT 1 FROM visit_messages WHERE idempotency_key = ?", args: [key] });
  return found.rows.length > 0;
}

async function queue(
  tx: Transaction,
  input: { propertyId: string; purpose: "ask" | "confirm" | "counter"; key: string; body: string; inReplyTo: string | null; at: string },
) {
  if (await hasKey(tx, input.key)) return;
  const domain = replyDomain();
  await tx.execute({
    sql: `INSERT INTO visit_messages (
            id, property_id, direction, purpose, provider_message_id, idempotency_key, rfc_message_id,
            in_reply_to, body, parsed, ranges_json, send_state, created_at
          ) VALUES (?, ?, 'out', ?, NULL, ?, ?, ?, ?, NULL, NULL, 'unsent', ?)`,
    args: [
      randomUUID(),
      input.propertyId,
      input.purpose,
      input.key,
      domain ? rfcMessageId(input.key, domain) : null,
      input.inReplyTo,
      input.body,
      input.at,
    ],
  });
}

async function applyStatus(
  tx: Transaction,
  row: Row,
  decision: { status: VisitStatus; attention: 0 | 1; time: "keep" | "clear" | "set" },
  slot: Interval | null,
  at: string,
  actor: string | null,
) {
  let start = text(row.confirmed_start);
  let end = text(row.confirmed_end);
  if (decision.time === "clear") {
    start = null;
    end = null;
  } else if (decision.time === "set" && slot) {
    start = slot.start;
    end = slot.end;
  }
  const from = asStatus(row.status);
  const cycle = decision.status === "por_contactar" && from !== "por_contactar" ? Number(row.cycle) + 1 : Number(row.cycle);
  await tx.execute({
    sql: `UPDATE visit_cases
             SET status = ?, confirmed_start = ?, confirmed_end = ?, attention = ?,
                 case_version = case_version + 1, cycle = ?, updated_at = ?
           WHERE property_id = ?`,
    args: [decision.status, start, end, decision.attention, cycle, at, String(row.property_id)],
  });
  if (decision.status === from && start === text(row.confirmed_start) && end === text(row.confirmed_end)) return;
  const payload: Record<string, string> = { from, to: decision.status };
  if (start && end) {
    payload.start = start;
    payload.end = end;
  }
  await record(tx, String(row.property_id), "visit_status", payload, actor, at);
}

async function bookStage(tx: Transaction, propertyId: PropertyId, at: string) {
  const found = await tx.execute({ sql: "SELECT stage, stage_version FROM properties WHERE id = ?", args: [propertyId] });
  const current = found.rows[0];
  if (!current || typeof current.stage !== "string" || current.stage === "descartada") return;
  // A lost race on the family stage keeps the visit that was just booked.
  await commitStage(tx, {
    propertyId,
    to: "visita_prevista",
    seen: Number(current.stage_version),
    actorId: null,
    now: at,
  });
}

function refOf(projectId: string, token: string) {
  return `${projectId}.${token}`;
}

async function open(tx: Transaction, command: Extract<VisitCommand, { type: "open" }>, at: string): Promise<Wrote> {
  const prop = await tx.execute({ sql: "SELECT title FROM properties WHERE id = ?", args: [command.propertyId] });
  if (!prop.rows.length) return stop("missing");
  const title = String(prop.rows[0].title);
  const existing = await tx.execute({ sql: "SELECT * FROM visit_cases WHERE property_id = ?", args: [command.propertyId] });
  const row = (existing.rows[0] as Row | undefined) ?? null;
  const project = await currentProjectId();
  if (!row) {
    if (command.caseVersion !== null) return stop("conflict");
    const token = randomBytes(32).toString("hex");
    const status = command.send ? "esperando_respuesta" : "por_contactar";
    await tx.execute({
      sql: `INSERT INTO visit_cases (
              property_id, contact_email, status, reply_token, note, attention, case_version, cycle,
              created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '', 0, 1, 1, ?, ?, ?)`,
      args: [command.propertyId, command.contactEmail, status, token, command.actorId, at, at],
    });
    if (command.send) {
      const letter = askLetter({ title, ref: refOf(project, token) });
      await queue(tx, {
        propertyId: command.propertyId,
        purpose: "ask",
        key: outboxKey({ purpose: "ask", propertyId: command.propertyId, cycle: 1 }),
        body: letter.text,
        inReplyTo: null,
        at,
      });
      await record(tx, command.propertyId, "visit_status", { from: "por_contactar", to: "esperando_respuesta" }, command.actorId, at);
    }
    return { commit: true, deliver: command.send, propertyId: command.propertyId };
  }
  const cycle = Number(row.cycle);
  const askKey = outboxKey({ purpose: "ask", propertyId: command.propertyId, cycle });
  if (command.send && (await hasKey(tx, askKey))) return { commit: false, deliver: true, propertyId: command.propertyId };
  if (command.caseVersion === null || Number(row.case_version) !== command.caseVersion) return stop("conflict");
  if (!command.send && String(row.contact_email) === command.contactEmail) {
    return { commit: false, deliver: false, propertyId: command.propertyId };
  }
  if (!command.send) {
    await tx.execute({
      sql: "UPDATE visit_cases SET contact_email = ?, case_version = case_version + 1, updated_at = ? WHERE property_id = ?",
      args: [command.contactEmail, at, command.propertyId],
    });
    return { commit: true, deliver: false, propertyId: command.propertyId };
  }
  const decision = nextVisitStatus(asStatus(row.status), { type: "asked" });
  if (!decision.ok) return stop("bad_move");
  await tx.execute({
    sql: "UPDATE visit_cases SET contact_email = ? WHERE property_id = ?",
    args: [command.contactEmail, command.propertyId],
  });
  await applyStatus(tx, row, decision, null, at, command.actorId);
  const letter = askLetter({ title, ref: refOf(project, String(row.reply_token)) });
  await queue(tx, {
    propertyId: command.propertyId,
    purpose: "ask",
    key: askKey,
    body: letter.text,
    inReplyTo: null,
    at,
  });
  return { commit: true, deliver: true, propertyId: command.propertyId };
}

async function ingest(tx: Transaction, command: Extract<VisitCommand, { type: "ingest" }>, now: Date, at: string): Promise<Wrote> {
  const found = await tx.execute({ sql: "SELECT * FROM visit_cases WHERE reply_token = ?", args: [command.token] });
  const row = found.rows[0] as Row | undefined;
  if (!row) return stop("no_case");
  const propertyId = String(row.property_id) as PropertyId;
  const duplicate = await tx.execute({
    sql: "SELECT 1 FROM visit_messages WHERE provider_message_id = ?",
    args: [command.providerMessageId],
  });
  if (duplicate.rows.length) return { commit: false, deliver: true, propertyId };
  const text = command.text.slice(0, INBOUND_CHARS);
  const parsed = parseReply(text, now);
  await tx.execute({
    sql: `INSERT INTO visit_messages (
            id, property_id, direction, purpose, provider_message_id, idempotency_key, rfc_message_id,
            in_reply_to, body, parsed, ranges_json, send_state, created_at
          ) VALUES (?, ?, 'in', 'reply', ?, NULL, NULL, ?, ?, ?, ?, 'received', ?)`,
    args: [
      randomUUID(),
      propertyId,
      command.providerMessageId,
      command.inReplyTo,
      text,
      parsed.available,
      JSON.stringify(parsed.ranges),
      at,
    ],
  });
  const pick: Pick | null =
    parsed.available === "yes" && parsed.ranges.length
      ? pickSlot({ offers: parsed.ranges, rulesByMember: await memberRules(tx), now })
      : null;
  const decision = nextVisitStatus(asStatus(row.status), { type: "reply", available: parsed.available, pick });
  if (!decision.ok) return stop("bad_move");
  const slot = pick?.kind === "slot" ? pick.slot : null;
  await applyStatus(tx, row, decision, slot, at, null);
  await record(tx, propertyId, "visit_reply", {}, null, at);
  const project = await currentProjectId();
  const ref = refOf(project, command.token);
  const titleRow = await tx.execute({ sql: "SELECT title FROM properties WHERE id = ?", args: [propertyId] });
  const title = String(titleRow.rows[0]?.title ?? "");
  if (decision.mail === "confirm" && slot) {
    const letter = confirmLetter({ title, slot, ref });
    await queue(tx, {
      propertyId,
      purpose: "confirm",
      key: outboxKey({ purpose: "confirm", propertyId, providerMessageId: command.providerMessageId }),
      body: letter.text,
      inReplyTo: command.providerMessageId,
      at,
    });
    await bookStage(tx, propertyId, at);
  } else if (decision.mail === "counter") {
    const letter = counterLetter({ title, ref });
    await queue(tx, {
      propertyId,
      purpose: "counter",
      key: outboxKey({ purpose: "counter", propertyId, providerMessageId: command.providerMessageId }),
      body: letter.text,
      inReplyTo: command.providerMessageId,
      at,
    });
  }
  return { commit: true, deliver: true, propertyId };
}

async function confirm(tx: Transaction, command: Extract<VisitCommand, { type: "confirm" }>, now: Date, at: string): Promise<Wrote> {
  const found = await tx.execute({ sql: "SELECT * FROM visit_cases WHERE property_id = ?", args: [command.propertyId] });
  const row = found.rows[0] as Row | undefined;
  if (!row) return stop("no_case");
  const key = outboxKey({ purpose: "hand", propertyId: command.propertyId, slot: command.slot });
  if (await hasKey(tx, key)) return { commit: false, deliver: true, propertyId: command.propertyId };
  if (Date.parse(command.slot.end) <= now.getTime()) return stop("bad_move");
  if (Number(row.case_version) !== command.caseVersion) return stop("conflict");
  const prop = await tx.execute({
    sql: "SELECT title, stage_version FROM properties WHERE id = ?",
    args: [command.propertyId],
  });
  if (!prop.rows.length) return stop("missing");
  if (Number(prop.rows[0].stage_version) !== command.stageVersion) return stop("conflict");
  const decision = nextVisitStatus(asStatus(row.status), { type: "hand_confirm" });
  if (!decision.ok) return stop("bad_move");
  await applyStatus(tx, row, decision, command.slot, at, command.actorId);
  const project = await currentProjectId();
  const letter = confirmLetter({
    title: String(prop.rows[0].title),
    slot: command.slot,
    ref: refOf(project, String(row.reply_token)),
  });
  await queue(tx, {
    propertyId: command.propertyId,
    purpose: "confirm",
    key,
    body: letter.text,
    inReplyTo: null,
    at,
  });
  const wrote = await commitStage(tx, {
    propertyId: command.propertyId,
    to: "visita_prevista",
    seen: command.stageVersion,
    actorId: command.actorId,
    now: at,
  });
  if (!wrote.ok) return stop("conflict");
  return { commit: true, deliver: true, propertyId: command.propertyId };
}

async function move(tx: Transaction, command: Extract<VisitCommand, { type: "move" }>, at: string): Promise<Wrote> {
  const found = await tx.execute({ sql: "SELECT * FROM visit_cases WHERE property_id = ?", args: [command.propertyId] });
  const row = found.rows[0] as Row | undefined;
  if (!row) return stop("no_case");
  if (Number(row.case_version) !== command.caseVersion) return stop("conflict");
  const decision = nextVisitStatus(asStatus(row.status), { type: "move", to: command.to });
  if (!decision.ok) return stop("bad_move");
  await applyStatus(tx, row, decision, null, at, command.actorId);
  return { commit: true, deliver: false, propertyId: command.propertyId };
}

async function note(tx: Transaction, command: Extract<VisitCommand, { type: "note" }>, at: string): Promise<Wrote> {
  if (command.text.length > NOTE_MAX) return stop("bad_move");
  const found = await tx.execute({
    sql: "SELECT case_version FROM visit_cases WHERE property_id = ?",
    args: [command.propertyId],
  });
  if (!found.rows.length) return stop("no_case");
  if (Number(found.rows[0].case_version) !== command.caseVersion) return stop("conflict");
  await tx.execute({
    sql: `UPDATE visit_cases SET note = ?, note_user_id = ?, note_at = ?, case_version = case_version + 1, updated_at = ?
          WHERE property_id = ?`,
    args: [command.text, command.actorId, at, at, command.propertyId],
  });
  return { commit: true, deliver: false, propertyId: command.propertyId };
}

async function saveRules(user: UserId, rules: readonly FreeRule[]) {
  const tx = await db.transaction("write");
  try {
    await tx.execute({ sql: "DELETE FROM visit_rules WHERE user_id = ?", args: [user] });
    for (const rule of rules) {
      if (rule.kind === "weekly") {
        await tx.execute({
          sql: `INSERT INTO visit_rules (id, user_id, kind, weekday, start_min, end_min, start_at, end_at, zone)
                VALUES (?, ?, 'weekly', ?, ?, ?, NULL, NULL, ?)`,
          args: [randomUUID(), user, rule.weekday, rule.startMin, rule.endMin, rule.zone],
        });
      } else {
        await tx.execute({
          sql: `INSERT INTO visit_rules (id, user_id, kind, weekday, start_min, end_min, start_at, end_at, zone)
                VALUES (?, ?, 'span', NULL, NULL, NULL, ?, ?, ?)`,
          args: [randomUUID(), user, rule.start, rule.end, rule.zone],
        });
      }
    }
    await tx.commit();
  } finally {
    if (!tx.closed) await tx.rollback();
  }
  return { ok: true as const, kind: "rules" as const, rules: await freeTime(user) };
}

async function sendUnsent(mail: Mailer) {
  const pending = await db.execute(
    `SELECT m.id, m.purpose, m.body, m.idempotency_key, m.rfc_message_id,
            c.contact_email, c.reply_token, c.confirmed_start, c.confirmed_end, p.title
       FROM visit_messages m
       JOIN visit_cases c ON c.property_id = m.property_id
       JOIN properties p ON p.id = m.property_id
      WHERE m.direction = 'out' AND m.send_state = 'unsent'
      ORDER BY m.created_at, m.id`,
  );
  if (!pending.rows.length) return 0;
  const domain = replyDomain();
  if (!domain) return 0;
  const project = await currentProjectId();
  let sent = 0;
  for (const row of pending.rows) {
    const address = replyAddress(project, String(row.reply_token), domain);
    const slot =
      row.confirmed_start && row.confirmed_end
        ? { start: instant(String(row.confirmed_start)), end: instant(String(row.confirmed_end)) }
        : null;
    const idempotencyKey = String(row.idempotency_key);
    const messageId = String(row.rfc_message_id ?? rfcMessageId(idempotencyKey, domain));
    const result = await mail.send({
      to: String(row.contact_email) as Email,
      from: `${FROM_NAME} <${address}>`,
      replyTo: address,
      subject: subjectFor(String(row.purpose), String(row.title), slot),
      text: String(row.body),
      idempotencyKey,
      messageId,
    });
    const tx = await db.transaction("write");
    try {
      const updated = await tx.execute({
        sql: "UPDATE visit_messages SET send_state = 'sent', provider_message_id = ?, rfc_message_id = ? WHERE id = ? AND send_state = 'unsent'",
        args: [result.providerMessageId, messageId, String(row.id)],
      });
      await tx.commit();
      if (Number(updated.rowsAffected) === 1) sent += 1;
    } finally {
      if (!tx.closed) await tx.rollback();
    }
  }
  return sent;
}

async function mailerFrom(given: Mailer | undefined): Promise<Mailer> {
  if (given) return given;
  const mail = (await import("./mail")) as { mailerFromEnv: () => Mailer };
  return mail.mailerFromEnv();
}

export async function act(command: VisitCommand, deps?: Partial<VisitDeps>): Promise<VisitResult> {
  const now = (deps?.now ?? (() => new Date()))();
  const at = now.toISOString();
  if (command.type === "save_rules") return saveRules(command.userId, command.rules);
  if (command.type === "deliver") {
    // No reply domain means there is no From address. Unsent rows wait until one is set.
    if (!deps?.mail && !process.env.MAIL_REPLY_DOMAIN?.trim()) return { ok: true, kind: "delivered", sent: 0 };
    return { ok: true, kind: "delivered", sent: await sendUnsent(await mailerFrom(deps?.mail)) };
  }
  const tx = await db.transaction("write");
  let wrote!: Wrote;
  try {
    wrote =
      command.type === "open"
        ? await open(tx, command, at)
        : command.type === "ingest"
          ? await ingest(tx, command, now, at)
          : command.type === "confirm"
            ? await confirm(tx, command, now, at)
            : command.type === "move"
              ? await move(tx, command, at)
              : await note(tx, command, at);
    if (wrote.commit) await tx.commit();
  } finally {
    if (!tx.closed) await tx.rollback();
  }
  if (wrote.deliver) await sendUnsent(await mailerFrom(deps?.mail));
  if ("result" in wrote) return wrote.result;
  const fresh = await loadCase(wrote.propertyId);
  return fresh ? { ok: true, kind: "case", case: fresh } : { ok: false, reason: "missing" };
}

function boardRow(row: Row): BoardRow {
  const start = text(row.confirmed_start);
  const end = text(row.confirmed_end);
  return {
    propertyId: String(row.property_id) as PropertyId,
    title: String(row.title),
    priceEur: num(row.price_eur),
    neighborhood: text(row.neighborhood),
    rooms: num(row.rooms),
    areaM2: num(row.area_m2),
    stage: String(row.stage) as Stage,
    stageVersion: Number(row.stage_version ?? 1),
    status: asStatus(row.status),
    attention: Number(row.attention) === 1,
    confirmed: start && end ? { start: instant(start), end: instant(end) } : null,
    contactEmail: String(row.contact_email) as Email,
    caseVersion: Number(row.case_version),
  };
}

const BOARD_SQL = `SELECT c.property_id, p.title, p.price_eur, p.neighborhood, p.rooms, p.area_m2,
                          p.stage, p.stage_version, c.status, c.attention, c.confirmed_start, c.confirmed_end,
                          c.contact_email, c.case_version, c.note
                     FROM visit_cases c
                     JOIN properties p ON p.id = c.property_id`;

export async function board(): Promise<BoardRow[]> {
  const rows = await db.execute(`${BOARD_SQL} ORDER BY c.attention DESC, c.updated_at DESC, c.property_id`);
  return rows.rows.map((row) => boardRow(row as Row));
}

export async function loadCase(id: PropertyId): Promise<VisitCaseView | null> {
  const found = await db.execute({ sql: `${BOARD_SQL} WHERE c.property_id = ?`, args: [id] });
  const row = found.rows[0] as Row | undefined;
  if (!row) return null;
  const messages = await db.execute({
    sql: `SELECT id, direction, purpose, body, created_at, send_state, ranges_json
            FROM visit_messages WHERE property_id = ? ORDER BY created_at, id`,
    args: [id],
  });
  return {
    ...boardRow(row),
    note: String(row.note ?? ""),
    messages: messages.rows.map((message) => ({
      id: String(message.id),
      direction: String(message.direction) as ThreadMessage["direction"],
      purpose: String(message.purpose) as ThreadMessage["purpose"],
      body: String(message.body),
      at: instant(String(message.created_at)),
      sendState: String(message.send_state) as ThreadMessage["sendState"],
      ranges: rangesOf(message.ranges_json),
    })),
  };
}

export async function freeTime(id: UserId): Promise<FreeRule[]> {
  const rows = await db.execute({
    sql: "SELECT kind, weekday, start_min, end_min, start_at, end_at, zone FROM visit_rules WHERE user_id = ? ORDER BY rowid",
    args: [id],
  });
  return rows.rows.flatMap((row) => {
    const rule = ruleFrom(row as Row);
    return rule ? [rule] : [];
  });
}
