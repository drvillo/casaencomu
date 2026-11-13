"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import type { DraftOwner } from "@/lib/draft-storage";
import { currentProjectId, db } from "@/lib/db";
import { STAGE_LABELS, STAGES, type Stage } from "@/lib/listing";
import { edit, post, remove, type CommentResult, type Reason } from "@/lib/comments";
import { publish, saveDraft, withdraw, type OpinionInput, type Result } from "@/lib/opinions";
import { setBudget } from "@/lib/settings";
import { commitStage } from "@/lib/stage";
import { propertyId as parsePropertyId, userId } from "@/lib/visit-plan";

const LIST = "/propiedades";
const detail = (id: string) => `${LIST}/${id}`;

const nonNegInt = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return typeof v === "string" && v !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};

export async function setBudgetAction(formData: FormData) {
  const user = await currentUser();
  const a = nonNegInt(formData.get("min"));
  const b = nonNegInt(formData.get("max"));
  // Either bound alone is a budget, and two empty fields clear it (F30).
  // ponytail: a reversed pair is a typo, not an error — swap it
  const [min, max] = a !== null && b !== null ? [Math.min(a, b), Math.max(a, b)] : [a, b];
  await setBudget(min, max, user.id);
  revalidatePath(LIST);
}

/**
 * What the stage box has to show afterwards. Nothing is typed here, so there is nothing to give
 * back — only the reason it was refused (F25).
 */
export type StageState = { ok: true; saved: string } | { ok: false; message: string } | null;

/**
 * The stage: where the family has decided this home is. The scores left this action in #141 (a
 * score is part of a published opinion) and the comment left it in #146 (a comment belongs beside
 * the thread it answers). What is left is the one thing that is neither one person's opinion nor
 * part of a conversation — the family's decision — and the version check that stops two people
 * moving it past each other.
 */
export async function stageAction(_prev: StageState, formData: FormData): Promise<StageState> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const user = await currentUser();

  const to = String(formData.get("etapa") ?? "");
  const seen = Number(formData.get("version"));

  if (!STAGES.includes(to as Stage)) return { ok: false, message: "Esa etapa no existe." };
  if (!Number.isInteger(seen)) return { ok: false, message: "Vuelve a cargar la página e inténtalo otra vez." };

  const parsed = parsePropertyId(propertyId);
  if (!parsed.ok) return { ok: false, message: "Esta propiedad ya no existe." };

  const tx = await db.transaction("write");
  try {
    const prop = await tx.execute({ sql: "SELECT stage, stage_version FROM properties WHERE id = ?", args: [propertyId] });
    const from = prop.rows[0]?.stage;
    if (typeof from !== "string") return { ok: false, message: "Esta propiedad ya no existe." };
    if (Number(prop.rows[0].stage_version) !== seen) {
      return {
        ok: false,
        message: `Otra persona la ha movido a ${STAGE_LABELS[from as Stage] ?? from} mientras mirabas. Míralo y vuelve a guardar.`,
      };
    }
    if (from === to) return { ok: false, message: "Ya está en esa etapa." };

    const now = new Date().toISOString();
    const wrote = await commitStage(tx, {
      propertyId: parsed.id,
      to: to as Stage,
      seen,
      actorId: userId(user.id),
      now,
    });
    if (!wrote.ok) {
      if (wrote.reason === "missing" || wrote.current === null) return { ok: false, message: "Esta propiedad ya no existe." };
      return {
        ok: false,
        message: `Otra persona la ha movido a ${STAGE_LABELS[wrote.current] ?? wrote.current} mientras mirabas. Míralo y vuelve a guardar.`,
      };
    }
    if (!wrote.changed) return { ok: false, message: "Ya está en esa etapa." };
    await tx.commit();
    revalidatePath(detail(propertyId));
    revalidatePath(LIST);
    return { ok: true, saved: STAGE_LABELS[to as Stage] };
  } finally {
    if (!tx.closed) await tx.rollback();
  }
}

/* -------------------------------------------------------------------------------------------
 * The conversation (#146). One action, three verbs, because all three share the same checks: the
 * same author, the same identifier, and the same words handed back when the write is refused.
 * `lib/comments.ts` decides; this only names the caller and turns a reason into a sentence.
 * ----------------------------------------------------------------------------------------- */

type Verb = "crear" | "editar" | "borrar";

/** What a refused write has to give back: the reason, and every word the author typed. */
export type CommentState = { ok: true; verb: Verb } | { ok: false; message: string; text: string } | null;

const WHY: Record<Reason, string> = {
  empty: "Escribe algo antes de enviarlo.",
  too_long: "Es demasiado largo. Córtalo un poco.",
  bad_id: "Vuelve a cargar la página e inténtalo otra vez.",
  gone: "Ese comentario ya no está.",
  not_yours: "Solo quien lo escribió puede cambiarlo.",
  conflict: "Se ha editado mientras escribías. Vuelve a cargar la página.",
  bad_parent: "No se puede responder a eso.",
  bad_reference: "Esa opinión no es de esta vivienda.",
};

export async function conversationAction(_prev: CommentState, formData: FormData): Promise<CommentState> {
  // The author, once, from the session. A form can carry any id it likes; every write below
  // matches on this one (V23).
  const user = await currentUser();
  const propertyId = String(formData.get("propertyId") ?? "");
  const verb = String(formData.get("verbo") ?? "") as Verb;
  const raw = String(formData.get("body") ?? "");
  const commentId = String(formData.get("commentId") ?? "");
  const version = Number(formData.get("version"));
  const now = new Date().toISOString();
  const back = { text: raw };

  let result: CommentResult;
  if (verb === "crear") {
    if (formData.get("draftAccount") !== user.email || formData.get("draftProject") !== await currentProjectId()) {
      return { ok: false, message: "La cuenta o el proyecto han cambiado. Vuelve a cargar la página.", text: "" };
    }
    result = await post(
      propertyId,
      user.id,
      {
        id: commentId,
        body: raw,
        parentId: String(formData.get("parentId") ?? "") || null,
        opinionUserId: String(formData.get("sobre") ?? "") || null,
      },
      now,
    );
  } else if (verb === "editar") {
    if (!Number.isInteger(version)) return { ok: false, message: WHY.bad_id, ...back };
    result = await edit(commentId, user.id, raw, version, now);
  } else if (verb === "borrar") {
    if (!Number.isInteger(version)) return { ok: false, message: WHY.bad_id, ...back };
    result = await remove(commentId, user.id, version, now);
  } else {
    return { ok: false, message: WHY.bad_id, ...back };
  }

  if (!result.ok) return { ok: false, message: WHY[result.reason], ...back };
  revalidatePath(detail(propertyId));
  return { ok: true, verb };
}

/* -------------------------------------------------------------------------------------------
 * The opinion itself (#141). Three actions, one rule: the author is `currentUser()` and never a
 * field in the request. An id that arrives with the form is a claim, not an identity, and a draft
 * is the one thing in this application that nobody else may read.
 *
 * Each one carries the version and revision the person's page was drawn from, so a second device
 * cannot be overwritten silently. `lib/opinions.ts` decides; this only names the caller and tells
 * Next.js what to redraw.
 * ----------------------------------------------------------------------------------------- */

type Expected = { version: number; revision: number } & DraftOwner;

const redraw = (propertyId: string) => {
  revalidatePath(detail(propertyId));
  revalidatePath(LIST);
};

export async function publishOpinionAction(propertyId: string, input: OpinionInput, expected: Expected): Promise<Result> {
  const user = await currentUser();
  if (expected.accountId !== user.email || expected.projectId !== await currentProjectId()) {
    return { ok: false, reason: "conflict" };
  }
  const result = await publish(propertyId, user.id, input, expected);
  if (result.ok) redraw(propertyId);
  return result;
}

export async function saveDraftAction(propertyId: string, input: OpinionInput, expected: Expected): Promise<Result> {
  const user = await currentUser();
  if (expected.accountId !== user.email || expected.projectId !== await currentProjectId()) {
    return { ok: false, reason: "conflict" };
  }
  // No path is revalidated: a draft changes nothing anybody else can see.
  return saveDraft(propertyId, user.id, input, { revision: expected.revision });
}

export async function withdrawOpinionAction(propertyId: string, expected: Expected): Promise<Result> {
  const user = await currentUser();
  if (expected.accountId !== user.email || expected.projectId !== await currentProjectId()) {
    return { ok: false, reason: "conflict" };
  }
  const result = await withdraw(propertyId, user.id, expected);
  if (result.ok) redraw(propertyId);
  return result;
}
