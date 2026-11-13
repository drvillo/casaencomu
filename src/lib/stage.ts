import { randomUUID } from "node:crypto";
import type { Transaction } from "@libsql/client";
import type { Stage } from "./listing";
import type { PropertyId, UserId } from "./visit-plan";

export type StageInput = {
  propertyId: PropertyId;
  to: Stage;
  seen: number;
  actorId: UserId | null;
  now: string;
};

export type StageWrite =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "missing" | "conflict"; current: Stage | null };

export async function commitStage(tx: Transaction, input: StageInput): Promise<StageWrite> {
  const cur = await tx.execute({
    sql: "SELECT stage, stage_version FROM properties WHERE id = ?",
    args: [input.propertyId],
  });
  const row = cur.rows[0];
  if (!row || typeof row.stage !== "string") return { ok: false, reason: "missing", current: null };
  const from = row.stage;
  if (from === input.to) return { ok: true, changed: false };
  const updated = await tx.execute({
    sql: "UPDATE properties SET stage = ?, stage_version = stage_version + 1, updated_at = ? WHERE id = ? AND stage_version = ?",
    args: [input.to, input.now, input.propertyId, input.seen],
  });
  if (Number(updated.rowsAffected) !== 1) {
    const again = await tx.execute({ sql: "SELECT stage FROM properties WHERE id = ?", args: [input.propertyId] });
    const current = again.rows[0] && typeof again.rows[0].stage === "string" ? (again.rows[0].stage as Stage) : null;
    return { ok: false, reason: again.rows.length ? "conflict" : "missing", current };
  }
  await tx.execute({
    sql: "INSERT INTO events (id, property_id, kind, payload_json, actor_id, created_at) VALUES (?, ?, 'stage_change', ?, ?, ?)",
    args: [randomUUID(), input.propertyId, JSON.stringify({ from, to: input.to }), input.actorId, input.now],
  });
  return { ok: true, changed: true };
}
