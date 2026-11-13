declare const userIdBrand: unique symbol;
declare const propertyIdBrand: unique symbol;
declare const zoneBrand: unique symbol;
declare const emailBrand: unique symbol;
declare const instantBrand: unique symbol;
declare const replyTokenBrand: unique symbol;
declare const providerMessageBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: true };
export type PropertyId = string & { readonly [propertyIdBrand]: true };
export type Zone = string & { readonly [zoneBrand]: true };
export type Email = string & { readonly [emailBrand]: true };
export type Instant = string & { readonly [instantBrand]: true };
export type ReplyToken = string & { readonly [replyTokenBrand]: true };
export type ProviderMessageId = string & { readonly [providerMessageBrand]: true };

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function userId(raw: string): UserId {
  if (!UUID.test(raw)) throw new Error("bad user id");
  return raw as UserId;
}

export function propertyId(raw: string): { ok: true; id: PropertyId } | { ok: false } {
  if (!UUID.test(raw)) return { ok: false };
  return { ok: true, id: raw as PropertyId };
}

export function replyToken(raw: string): ReplyToken {
  const value = raw.trim().toLowerCase();
  if (!HEX_64.test(value)) throw new Error("bad reply token");
  return value as ReplyToken;
}

export function providerMessageId(raw: string): ProviderMessageId {
  const value = raw.trim();
  if (value.length < 1 || value.length > 200 || /\s/.test(value)) throw new Error("bad provider message id");
  return value as ProviderMessageId;
}

export function emailAddress(raw: string): { ok: true; email: Email } | { ok: false } {
  const value = raw.trim();
  if (value.length > 200 || !EMAIL.test(value)) return { ok: false };
  return { ok: true, email: value as Email };
}

export function zone(raw: string): { ok: true; zone: Zone } | { ok: false } {
  const value = raw.trim();
  if (!Intl.supportedValuesOf("timeZone").includes(value)) return { ok: false };
  return { ok: true, zone: value as Zone };
}

export function instant(raw: string): Instant {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new Error("bad instant");
  return new Date(ms).toISOString() as Instant;
}

export type Interval = { start: Instant; end: Instant };

export function interval(start: Instant, end: Instant): Interval {
  if (start >= end) throw new Error("bad interval");
  return { start, end };
}

export type FreeRule =
  | { kind: "weekly"; weekday: Weekday; startMin: number; endMin: number; zone: Zone }
  | { kind: "span"; start: Instant; end: Instant; zone: Zone };

export function weeklyRule(input: {
  weekday: Weekday;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  zone: Zone;
}): { ok: true; rule: FreeRule } | { ok: false; reason: "bad_clock" } {
  const start = input.startHour * 60 + input.startMinute;
  const end = input.endHour * 60 + input.endMinute;
  const clock =
    Number.isInteger(input.startHour) &&
    input.startHour >= 0 &&
    input.startHour <= 23 &&
    Number.isInteger(input.endHour) &&
    input.endHour >= 0 &&
    input.endHour <= 24 &&
    Number.isInteger(input.startMinute) &&
    input.startMinute >= 0 &&
    input.startMinute <= 59 &&
    Number.isInteger(input.endMinute) &&
    input.endMinute >= 0 &&
    input.endMinute <= 59 &&
    !(input.endHour === 24 && input.endMinute !== 0);
  if (!clock || start < 0 || end > 24 * 60 || start >= end) return { ok: false, reason: "bad_clock" };
  return {
    ok: true,
    rule: { kind: "weekly", weekday: input.weekday, startMin: start, endMin: end, zone: input.zone },
  };
}

export type WallClock = {
  year: number;
  month: number;
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  zone: Zone;
};

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function realDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function normalizeWall(year: number, month: number, day: number, hour: number, minute: number): Wall {
  if (hour === 24 && minute === 0) {
    const next = addDays(year, month, day, 1);
    return { ...next, hour: 0, minute: 0 };
  }
  return { year, month, day, hour, minute };
}

function wallParts(ms: number, zoneName: string): Wall {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = new Map(fmt.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  let hour = Number(bag.get("hour"));
  let year = Number(bag.get("year"));
  let month = Number(bag.get("month"));
  let day = Number(bag.get("day"));
  if (hour === 24) {
    hour = 0;
    const next = addDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return { year, month, day, hour, minute: Number(bag.get("minute")) };
}

function minuteDiff(got: Wall, want: Wall) {
  const left = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
  const right = Date.UTC(want.year, want.month - 1, want.day, want.hour, want.minute);
  return (left - right) / 60000;
}

function resolveWall(want: Wall, zoneName: string): Instant | null {
  let ms = Date.UTC(want.year, want.month - 1, want.day, want.hour, want.minute);
  for (let i = 0; i < 2; i++) {
    const diff = minuteDiff(wallParts(ms, zoneName), want);
    if (diff === 0) return new Date(ms).toISOString() as Instant;
    ms -= diff * 60000;
  }
  if (minuteDiff(wallParts(ms, zoneName), want) === 0) return new Date(ms).toISOString() as Instant;
  return null;
}

function clockOk(hour: number, minute: number, end: boolean) {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= (end ? 24 : 23) &&
    minute >= 0 &&
    minute <= 59 &&
    !(hour === 24 && minute !== 0)
  );
}

export function wallInterval(
  input: WallClock,
): { ok: true; slot: Interval } | { ok: false; reason: "bad_clock" | "bad_range" } {
  if (!clockOk(input.startHour, input.startMinute, false) || !clockOk(input.endHour, input.endMinute, true)) {
    return { ok: false, reason: "bad_clock" };
  }
  const startMin = input.startHour * 60 + input.startMinute;
  const endMin = input.endHour * 60 + input.endMinute;
  if (startMin >= endMin) return { ok: false, reason: "bad_range" };
  if (!realDate(input.year, input.month, input.day)) return { ok: false, reason: "bad_clock" };
  const start = resolveWall(
    { year: input.year, month: input.month, day: input.day, hour: input.startHour, minute: input.startMinute },
    input.zone,
  );
  const end = resolveWall(normalizeWall(input.year, input.month, input.day, input.endHour, input.endMinute), input.zone);
  if (!start || !end) return { ok: false, reason: "bad_clock" };
  if (start >= end) return { ok: false, reason: "bad_range" };
  return { ok: true, slot: { start, end } };
}

export function spanRule(input: WallClock): { ok: true; rule: FreeRule } | { ok: false; reason: "bad_clock" | "bad_range" } {
  const slot = wallInterval(input);
  if (!slot.ok) return slot;
  return { ok: true, rule: { kind: "span", start: slot.slot.start, end: slot.slot.end, zone: input.zone } };
}

export const VISIT_STATUSES = [
  "por_contactar",
  "contactado",
  "esperando_respuesta",
  "no_sigue",
  "visita_propuesta",
  "visita_confirmada",
  "visitada",
  "rechazada",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_LABELS: Record<VisitStatus, string> = {
  por_contactar: "Por contactar",
  contactado: "Contactado",
  esperando_respuesta: "Esperando respuesta",
  no_sigue: "No sigue",
  visita_propuesta: "Visita propuesta",
  visita_confirmada: "Visita confirmada",
  visitada: "Visitada",
  rechazada: "Rechazada",
};

export const MANUAL_TARGETS: Record<VisitStatus, readonly VisitStatus[]> = {
  por_contactar: ["contactado", "no_sigue", "rechazada"],
  contactado: ["por_contactar", "esperando_respuesta", "no_sigue", "rechazada"],
  esperando_respuesta: ["por_contactar", "contactado", "no_sigue", "visita_propuesta", "rechazada"],
  visita_propuesta: ["por_contactar", "esperando_respuesta", "no_sigue", "rechazada"],
  visita_confirmada: ["visitada", "esperando_respuesta", "por_contactar", "no_sigue", "rechazada"],
  visitada: ["por_contactar", "rechazada"],
  no_sigue: ["por_contactar", "rechazada"],
  rechazada: ["por_contactar"],
};

export const ADVERTISER_ZONE = "Europe/Madrid";
export const VISIT_MINUTES = 30;
export const LEAD_MS = 12 * 60 * 60 * 1000;
export const NOTE_MAX = 2000;
export const INBOUND_CHARS = 100_000;
export const PARSER_CHARS = 8_000;

export type ParsedReply = {
  available: "yes" | "no" | "unknown";
  ranges: Interval[];
};

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const WEEKDAYS: Record<string, Weekday> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const REFUSALS = ["ya no esta", "no esta disponible", "no disponible", "vendid", "alquilad", "reservad", "no sigue"].sort(
  (a, b) => b.length - a.length,
);

type ClockSpec = { startHour: number; startMinute: number; endHour: number; endMinute: number };

function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function madridNow(now: Date): Wall {
  const zoneName = zone(ADVERTISER_ZONE);
  if (!zoneName.ok) throw new Error("bad advertiser zone");
  return wallParts(now.getTime(), zoneName.zone);
}

function isoWeekday(year: number, month: number, day: number): Weekday {
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (js === 0 ? 7 : js) as Weekday;
}

function advertiserZone(): Zone {
  const parsed = zone(ADVERTISER_ZONE);
  if (!parsed.ok) throw new Error("bad advertiser zone");
  return parsed.zone;
}

function clockInterval(year: number, month: number, day: number, clock: ClockSpec): Interval | null {
  if (!realDate(year, month, day)) return null;
  const start = resolveWall({ year, month, day, hour: clock.startHour, minute: clock.startMinute }, advertiserZone());
  const endWall = normalizeWall(year, month, day, clock.endHour, clock.endMinute);
  const end = resolveWall(endWall, advertiserZone());
  if (!start || !end || start >= end) return null;
  return { start, end };
}

function civilDay(year: number, month: number, day: number): Interval | null {
  const slot = wallInterval({
    year,
    month,
    day,
    startHour: 0,
    startMinute: 0,
    endHour: 24,
    endMinute: 0,
    zone: advertiserZone(),
  });
  return slot.ok ? slot.slot : null;
}

function singleClock(hour: number, minute: number): ClockSpec | null {
  if (!clockOk(hour, minute, false)) return null;
  const total = hour * 60 + minute + VISIT_MINUTES;
  return { startHour: hour, startMinute: minute, endHour: Math.floor(total / 60), endMinute: total % 60 };
}

function rangedClock(startHour: number, startMinute: number, endHour: number, endMinute: number): ClockSpec | null {
  if (!clockOk(startHour, startMinute, false) || !clockOk(endHour, endMinute, true)) return null;
  if (startHour * 60 + startMinute >= endHour * 60 + endMinute) return null;
  return { startHour, startMinute, endHour, endMinute };
}

function readClock(window: string): ClockSpec | null {
  const src = window.slice(0, 80);
  const words = src.match(
    /(?:de|desde)\s+(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:a|hasta|-)\s*(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*h?/,
  );
  if (words) return rangedClock(Number(words[1]), Number(words[2] ?? 0), Number(words[3]), Number(words[4] ?? 0));
  const clocks = src.match(/\b(\d{1,2}):(\d{2})\s*(?:a|hasta|-)\s*(\d{1,2}):(\d{2})\b/);
  if (clocks) return rangedClock(Number(clocks[1]), Number(clocks[2]), Number(clocks[3]), Number(clocks[4]));
  const spoken = src.match(/(?:a\s+las|a\s+la|las)\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (spoken) return singleClock(Number(spoken[1]), Number(spoken[2] ?? 0));
  const hm = src.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) return singleClock(Number(hm[1]), Number(hm[2]));
  const hour = src.match(/\b(\d{1,2})\s*h(?:oras?)?\b/);
  if (hour) return singleClock(Number(hour[1]), 0);
  return null;
}

type Anchor = {
  index: number;
  end: number;
  kind: "dated" | "weekday";
  make: (clock: ClockSpec | null) => Interval | null;
};

function pushMatches(text: string, pattern: RegExp, push: (match: RegExpExecArray) => void) {
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    push(match);
    match = pattern.exec(text);
  }
}

function anchorsOf(text: string, now: Date): Anchor[] {
  const found: Anchor[] = [];
  pushMatches(text, /\b(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(z|[+-]\d{2}:?\d{2})?)?\b/gi, (match) => {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] === undefined ? null : Number(match[4]);
    const minute = match[5] === undefined ? null : Number(match[5]);
    const suffix = match[6];
    found.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: "dated",
      make: (clock) => {
        if (hour !== null && minute !== null && suffix) {
          const parsed = Date.parse(match[0]);
          if (Number.isNaN(parsed)) return null;
          return {
            start: new Date(parsed).toISOString() as Instant,
            end: new Date(parsed + VISIT_MINUTES * 60 * 1000).toISOString() as Instant,
          };
        }
        if (hour !== null && minute !== null) {
          const spec = singleClock(hour, minute);
          return spec ? clockInterval(year, month, day, spec) : null;
        }
        return clock ? clockInterval(year, month, day, clock) : civilDay(year, month, day);
      },
    });
  });
  pushMatches(text, /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, (match) => {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    found.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: "dated",
      make: (clock) => (clock ? clockInterval(year, month, day, clock) : civilDay(year, month, day)),
    });
  });
  pushMatches(
    text,
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/g,
    (match) => {
      const day = Number(match[1]);
      const month = MONTHS[match[2]] ?? 0;
      const year = match[3] ? Number(match[3]) : null;
      found.push({
        index: match.index,
        end: match.index + match[0].length,
        kind: "dated",
        make: (clock) => {
          const chosen = year ?? yearFor(month, day, now, clock);
          return clock ? clockInterval(chosen, month, day, clock) : civilDay(chosen, month, day);
        },
      });
    },
  );
  pushMatches(text, /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g, (match) => {
    const weekday = WEEKDAYS[match[1]];
    found.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: "weekday",
      make: (clock) => weekdayInterval(weekday, now, clock),
    });
  });
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const taken: Anchor[] = [];
  for (const anchor of found) {
    if (taken.some((kept) => anchor.index < kept.end && kept.index < anchor.end)) continue;
    taken.push(anchor);
  }
  taken.sort((a, b) => a.index - b.index);
  return taken.filter((anchor, index) => {
    if (anchor.kind !== "weekday") return true;
    const next = taken.slice(index + 1).find((item) => item.kind === "dated");
    if (!next) return true;
    return !/^[\s,.]*$/.test(text.slice(anchor.end, next.index));
  });
}

function yearFor(month: number, day: number, now: Date, clock: ClockSpec | null) {
  const today = madridNow(now);
  for (const year of [today.year, today.year + 1]) {
    const slot = clock ? clockInterval(year, month, day, clock) : civilDay(year, month, day);
    if (slot && Date.parse(slot.end) > now.getTime()) return year;
  }
  return today.year + 1;
}

function weekdayInterval(weekday: Weekday, now: Date, clock: ClockSpec | null): Interval | null {
  const today = madridNow(now);
  const delta = (weekday - isoWeekday(today.year, today.month, today.day) + 7) % 7;
  for (let hop = 0; hop < 3; hop++) {
    const date = addDays(today.year, today.month, today.day, delta + hop * 7);
    const slot = clock ? clockInterval(date.year, date.month, date.day, clock) : civilDay(date.year, date.month, date.day);
    if (slot && Date.parse(slot.end) > now.getTime()) return slot;
  }
  return null;
}

function extractRanges(text: string, now: Date): Interval[] {
  const anchors = anchorsOf(text, now);
  const ranges: Interval[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const next = anchors[i + 1];
    const window = text.slice(anchor.end, next ? Math.min(next.index, anchor.end + 80) : anchor.end + 80);
    const slot = anchor.make(readClock(window));
    if (slot) ranges.push(slot);
  }
  const seen = new Set<string>();
  return ranges
    .filter((range) => {
      const key = `${range.start}/${range.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1));
}

export function parseReply(text: string, now: Date): ParsedReply {
  const folded = fold(text.slice(0, PARSER_CHARS));
  const ranges = extractRanges(folded, now);
  const refusal = REFUSALS.some((phrase) => folded.includes(phrase));
  if (refusal && ranges.length === 0) return { available: "no", ranges: [] };
  if (refusal) return { available: "unknown", ranges };
  if (ranges.length > 0) return { available: "yes", ranges };
  return { available: "unknown", ranges: [] };
}

export type Pick = { kind: "slot"; slot: Interval } | { kind: "none" } | { kind: "no_rules" };

type MsSpan = { start: number; end: number };

function mergeSpans(bits: MsSpan[]): MsSpan[] {
  const sorted = [...bits].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MsSpan[] = [];
  for (const bit of sorted) {
    const last = out[out.length - 1];
    if (!last || bit.start > last.end) out.push({ ...bit });
    else last.end = Math.max(last.end, bit.end);
  }
  return out;
}

function intersectSpans(left: MsSpan[], right: MsSpan[]): MsSpan[] {
  const out: MsSpan[] = [];
  for (const a of left) {
    for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start < end) out.push({ start, end });
    }
  }
  return mergeSpans(out);
}

function localDays(startMs: number, endMs: number, zoneName: string) {
  const first = wallParts(startMs, zoneName);
  const last = wallParts(Math.max(startMs, endMs - 1), zoneName);
  const days: { year: number; month: number; day: number }[] = [];
  let cursor = { year: first.year, month: first.month, day: first.day };
  for (let i = 0; i < 400; i++) {
    days.push(cursor);
    if (cursor.year === last.year && cursor.month === last.month && cursor.day === last.day) break;
    cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
  }
  return days;
}

function ruleSpans(rule: FreeRule, offer: Interval): MsSpan[] {
  const offerStart = Date.parse(offer.start);
  const offerEnd = Date.parse(offer.end);
  if (rule.kind === "span") {
    const start = Math.max(Date.parse(rule.start), offerStart);
    const end = Math.min(Date.parse(rule.end), offerEnd);
    return start < end ? [{ start, end }] : [];
  }
  const bits: MsSpan[] = [];
  for (const day of localDays(offerStart, offerEnd, rule.zone)) {
    if (isoWeekday(day.year, day.month, day.day) !== rule.weekday) continue;
    const slot = wallInterval({
      year: day.year,
      month: day.month,
      day: day.day,
      startHour: Math.floor(rule.startMin / 60),
      startMinute: rule.startMin % 60,
      endHour: Math.floor(rule.endMin / 60),
      endMinute: rule.endMin % 60,
      zone: rule.zone,
    });
    if (!slot.ok) continue;
    const start = Math.max(Date.parse(slot.slot.start), offerStart);
    const end = Math.min(Date.parse(slot.slot.end), offerEnd);
    if (start < end) bits.push({ start, end });
  }
  return mergeSpans(bits);
}

export function pickSlot(input: {
  offers: readonly Interval[];
  rulesByMember: readonly (readonly FreeRule[])[];
  now: Date;
}): Pick {
  if (input.rulesByMember.every((rules) => rules.length === 0)) return { kind: "no_rules" };
  const members = input.rulesByMember.filter((rules) => rules.length > 0);
  const nowMs = input.now.getTime();
  const visitMs = VISIT_MINUTES * 60 * 1000;
  const candidates: { start: number; end: number; offer: number }[] = [];
  input.offers.forEach((offer, offerIndex) => {
    let pieces: MsSpan[] = [{ start: Date.parse(offer.start), end: Date.parse(offer.end) }];
    for (const rules of members) {
      const free = mergeSpans(rules.flatMap((rule) => ruleSpans(rule, offer)));
      pieces = intersectSpans(pieces, free);
    }
    for (const piece of pieces) {
      const start = piece.start > nowMs ? piece.start : Math.ceil((nowMs + 1) / 60_000) * 60_000;
      if (start + visitMs > piece.end) continue;
      candidates.push({ start, end: start + visitMs, offer: offerIndex });
    }
  });
  if (candidates.length === 0) return { kind: "none" };
  const lead = nowMs + LEAD_MS;
  const ahead = candidates.filter((item) => item.start >= lead);
  const pool = (ahead.length > 0 ? ahead : candidates).sort(
    (a, b) => a.start - b.start || a.end - b.end || a.offer - b.offer,
  );
  const chosen = pool[0];
  return { kind: "slot", slot: { start: new Date(chosen.start).toISOString() as Instant, end: new Date(chosen.end).toISOString() as Instant } };
}

type Effect = {
  status: VisitStatus;
  attention: 0 | 1;
  time: "keep" | "clear" | "set";
  mail: "none" | "ask" | "confirm" | "counter";
};

export type StatusDecision = ({ ok: true } & Effect) | { ok: false; reason: "bad_move" };

type ReplyClass = "yes_slot" | "yes_none" | "yes_no_rules" | "no" | "unknown";

function replyClass(available: "yes" | "no" | "unknown", pick: Pick | null): ReplyClass {
  if (available === "no") return "no";
  if (available === "unknown") return "unknown";
  if (pick?.kind === "slot") return "yes_slot";
  if (pick?.kind === "no_rules") return "yes_no_rules";
  return "yes_none";
}

function openEffect(stay: VisitStatus, cls: ReplyClass): Effect {
  switch (cls) {
    case "yes_slot":
      return { status: "visita_confirmada", attention: 0, time: "set", mail: "confirm" };
    case "yes_none":
      return { status: "visita_propuesta", attention: 1, time: "clear", mail: "counter" };
    case "no":
      return { status: "no_sigue", attention: 1, time: "clear", mail: "none" };
    case "yes_no_rules":
    case "unknown":
      return { status: stay, attention: 1, time: "keep", mail: "none" };
  }
}

export type VisitEvent =
  | { type: "asked" }
  | { type: "reply"; available: "yes" | "no" | "unknown"; pick: Pick | null }
  | { type: "hand_confirm" }
  | { type: "move"; to: VisitStatus };

export function nextVisitStatus(from: VisitStatus, event: VisitEvent): StatusDecision {
  if (event.type === "asked") {
    if (from === "por_contactar" || from === "contactado") {
      return { ok: true, status: "esperando_respuesta", attention: 0, time: "clear", mail: "ask" };
    }
    return { ok: false, reason: "bad_move" };
  }
  if (event.type === "hand_confirm") {
    return { ok: true, status: "visita_confirmada", attention: 0, time: "set", mail: "confirm" };
  }
  if (event.type === "move") {
    if (!MANUAL_TARGETS[from].includes(event.to)) return { ok: false, reason: "bad_move" };
    return {
      ok: true,
      status: event.to,
      attention: 0,
      time: event.to === "visitada" ? "keep" : "clear",
      mail: "none",
    };
  }
  const cls = replyClass(event.available, event.pick);
  if (from === "contactado" || from === "esperando_respuesta" || from === "visita_propuesta") {
    return { ok: true, ...openEffect(from, cls) };
  }
  if (from === "por_contactar" && cls === "no") {
    return { ok: true, status: "no_sigue", attention: 1, time: "clear", mail: "none" };
  }
  return { ok: true, status: from, attention: 1, time: "keep", mail: "none" };
}

export function visitStatusClause(payload: {
  from?: unknown;
  to?: unknown;
  start?: unknown;
  end?: unknown;
}): string {
  const label = (value: unknown) =>
    typeof value === "string" && value in VISIT_LABELS ? VISIT_LABELS[value as VisitStatus] : String(value ?? "");
  if (typeof payload.start === "string" && typeof payload.end === "string") {
    const when = new Intl.DateTimeFormat("es-ES", {
      timeZone: ADVERTISER_ZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Visita confirmada: ${when.format(new Date(payload.start))} a ${when.format(new Date(payload.end))}`;
  }
  return `Visita: ${label(payload.from)} → ${label(payload.to)}`;
}
