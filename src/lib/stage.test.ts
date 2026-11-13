import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { commitStage } from "./stage";
import { propertyId } from "./visit-plan";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "casa-stage-"));
const { db, applySchema } = await import("./db");

const at = "2026-11-13T09:00:00.000Z";

beforeAll(async () => {
  await applySchema();
});

describe("commitStage", () => {
  it("lets the first write record the change and the overlapping write record nothing", async () => {
    const id = randomUUID();
    const parsed = propertyId(id);
    if (!parsed.ok) throw new Error("id");
    await db.execute({
      sql: "INSERT INTO properties (id, title, stage, created_at, updated_at) VALUES (?, 'Piso', 'revisando', ?, ?)",
      args: [id, at, at],
    });

    const first = await db.transaction("write");
    try {
      expect(
        await commitStage(first, { propertyId: parsed.id, to: "preseleccionada", seen: 1, actorId: null, now: at }),
      ).toEqual({ ok: true, changed: true });
      await first.commit();
    } finally {
      if (!first.closed) await first.rollback();
    }

    const second = await db.transaction("write");
    try {
      expect(
        await commitStage(second, { propertyId: parsed.id, to: "descartada", seen: 1, actorId: null, now: at }),
      ).toEqual({ ok: false, reason: "conflict", current: "preseleccionada" });
    } finally {
      if (!second.closed) await second.rollback();
    }

    const events = await db.execute({
      sql: "SELECT payload_json FROM events WHERE property_id = ? AND kind = 'stage_change'",
      args: [id],
    });
    expect(events.rows).toHaveLength(1);
    expect(JSON.parse(String(events.rows[0].payload_json))).toEqual({ from: "revisando", to: "preseleccionada" });
  });
});
