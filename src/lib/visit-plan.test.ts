import { describe, expect, it } from "vitest";
import {
  instant,
  interval,
  nextVisitStatus,
  parseReply,
  pickSlot,
  wallInterval,
  weeklyRule,
  zone,
  type FreeRule,
  type Instant,
} from "./visit-plan";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const madrid = zone("Europe/Madrid");
if (!madrid.ok) throw new Error("Europe/Madrid");

const at = (value: string) => value as Instant;

describe("parseReply", () => {
  it("reads a Spanish date and one clock as thirty minutes", () => {
    expect(
      parseReply("El piso sigue disponible. Podemos el martes 18 de noviembre de 2026 a las 10:00.", NOW),
    ).toEqual({
      available: "yes",
      ranges: [{ start: "2026-11-18T09:00:00.000Z", end: "2026-11-18T09:30:00.000Z" }],
    });
  });

  it("reads a bare refusal as no", () => {
    expect(parseReply("Ya no está disponible.", NOW)).toEqual({ available: "no", ranges: [] });
  });

  it("keeps a range when the refusal also offers a time", () => {
    expect(parseReply("No está disponible, pero el jueves a las 17:00 podría ser.", NOW)).toEqual({
      available: "unknown",
      ranges: [{ start: "2026-11-19T16:00:00.000Z", end: "2026-11-19T16:30:00.000Z" }],
    });
  });

  it("leaves a greeting unknown", () => {
    expect(parseReply("Hola, recibí tu mensaje.", NOW)).toEqual({ available: "unknown", ranges: [] });
  });
});

describe("wallInterval", () => {
  it("rejects 02:30 on the spring-forward morning", () => {
    expect(
      wallInterval({
        year: 2026,
        month: 3,
        day: 29,
        startHour: 2,
        startMinute: 30,
        endHour: 3,
        endMinute: 0,
        zone: madrid.zone,
      }),
    ).toEqual({ ok: false, reason: "bad_clock" });
  });

  it("reads 10:00 in Madrid as 09:00 UTC in November", () => {
    expect(
      wallInterval({
        year: 2026,
        month: 11,
        day: 18,
        startHour: 10,
        startMinute: 0,
        endHour: 10,
        endMinute: 30,
        zone: madrid.zone,
      }),
    ).toEqual({ ok: true, slot: { start: "2026-11-18T09:00:00.000Z", end: "2026-11-18T09:30:00.000Z" } });
  });
});

describe("pickSlot", () => {
  const wednesday = weeklyRule({
    weekday: 3,
    startHour: 10,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    zone: madrid.zone,
  });
  if (!wednesday.ok) throw new Error("rule");
  const offer = interval(instant("2026-11-18T08:00:00.000Z"), instant("2026-11-18T12:00:00.000Z"));
  const early = new Date("2026-11-17T08:00:00.000Z");
  const wanted = { start: "2026-11-18T09:00:00.000Z", end: "2026-11-18T09:30:00.000Z" };

  it("books the overlap start when the lead time is met", () => {
    expect(pickSlot({ offers: [offer], rulesByMember: [[wednesday.rule], [wednesday.rule]], now: early })).toEqual({
      kind: "slot",
      slot: wanted,
    });
  });

  it("ignores a member who has saved no rules", () => {
    expect(
      pickSlot({ offers: [offer], rulesByMember: [[wednesday.rule], [], [wednesday.rule]], now: early }),
    ).toEqual({ kind: "slot", slot: wanted });
  });

  it("sends nothing when every list is empty", () => {
    expect(pickSlot({ offers: [offer], rulesByMember: [[], []], now: early })).toEqual({ kind: "no_rules" });
  });

  const cover: FreeRule = {
    kind: "span",
    start: instant("2026-11-18T00:00:00.000Z"),
    end: instant("2026-11-20T00:00:00.000Z"),
    zone: madrid.zone,
  };
  const now = new Date("2026-11-18T08:00:00.000Z");
  const twoHours = interval(instant("2026-11-18T10:00:00.000Z"), instant("2026-11-18T11:00:00.000Z"));
  const twentyHours = interval(instant("2026-11-19T04:00:00.000Z"), instant("2026-11-19T05:00:00.000Z"));

  it("prefers the start that is at least twelve hours ahead", () => {
    expect(pickSlot({ offers: [twoHours, twentyHours], rulesByMember: [[cover]], now })).toEqual({
      kind: "slot",
      slot: { start: "2026-11-19T04:00:00.000Z", end: "2026-11-19T04:30:00.000Z" },
    });
  });

  it("takes the only start that is still after now", () => {
    expect(pickSlot({ offers: [twoHours], rulesByMember: [[cover]], now })).toEqual({
      kind: "slot",
      slot: { start: "2026-11-18T10:00:00.000Z", end: "2026-11-18T10:30:00.000Z" },
    });
  });

  it("drops a slot that has already ended", () => {
    const past = interval(instant("2026-11-18T06:00:00.000Z"), instant("2026-11-18T07:00:00.000Z"));
    expect(pickSlot({ offers: [past], rulesByMember: [[cover]], now })).toEqual({ kind: "none" });
  });
});

describe("nextVisitStatus", () => {
  const slot = { start: at("2026-11-18T09:00:00.000Z"), end: at("2026-11-18T09:30:00.000Z") };

  it("confirms a fitting reply", () => {
    expect(
      nextVisitStatus("esperando_respuesta", { type: "reply", available: "yes", pick: { kind: "slot", slot } }),
    ).toEqual({ ok: true, status: "visita_confirmada", attention: 0, time: "set", mail: "confirm" });
  });

  it("counters a miss", () => {
    expect(nextVisitStatus("esperando_respuesta", { type: "reply", available: "yes", pick: { kind: "none" } })).toEqual({
      ok: true,
      status: "visita_propuesta",
      attention: 1,
      time: "clear",
      mail: "counter",
    });
  });

  it("stops on a refusal", () => {
    expect(nextVisitStatus("esperando_respuesta", { type: "reply", available: "no", pick: null })).toEqual({
      ok: true,
      status: "no_sigue",
      attention: 1,
      time: "clear",
      mail: "none",
    });
  });

  it("stays put when nobody has rules", () => {
    expect(
      nextVisitStatus("esperando_respuesta", { type: "reply", available: "yes", pick: { kind: "no_rules" } }),
    ).toEqual({ ok: true, status: "esperando_respuesta", attention: 1, time: "keep", mail: "none" });
  });

  it("keeps a visited home and sends nothing", () => {
    expect(nextVisitStatus("visitada", { type: "reply", available: "yes", pick: { kind: "slot", slot } })).toEqual({
      ok: true,
      status: "visitada",
      attention: 1,
      time: "keep",
      mail: "none",
    });
  });

  it("refuses a manual jump to a confirmed visit", () => {
    expect(nextVisitStatus("esperando_respuesta", { type: "move", to: "visita_confirmada" })).toEqual({
      ok: false,
      reason: "bad_move",
    });
  });

  it("lets a hand confirm reopen a refusal", () => {
    expect(nextVisitStatus("rechazada", { type: "hand_confirm" })).toEqual({
      ok: true,
      status: "visita_confirmada",
      attention: 0,
      time: "set",
      mail: "confirm",
    });
  });
});
