"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import {
  act,
  ADVERTISER_ZONE,
  emailAddress,
  NOTE_MAX,
  propertyId,
  spanRule,
  userId,
  wallInterval,
  weeklyRule,
  zone,
  type FreeRule,
} from "@/lib/visit";
import { VISIT_STATUSES, type VisitStatus, type Weekday } from "@/lib/visit-plan";

export type NoteState = { ok: true } | { ok: false; message: string; note: string } | null;
export type MailState = { ok: true } | { ok: false; message: string; email: string } | null;
export type ConfirmState =
  | { ok: true }
  | { ok: false; message: string; fecha: string; inicio: string; fin: string }
  | null;
export type MoveState = { ok: true } | { ok: false; message: string } | null;
export type HoursState = { ok: true } | { ok: false; message: string } | null;

const RELOAD = "Vuelve a cargar la página e inténtalo otra vez.";
const LATER = "La hora de fin tiene que ser posterior.";
const BAD_CLOCK = "Esa hora no existe.";

function say(reason: string) {
  if (reason === "conflict") return "Otra persona lo ha cambiado. Míralo y vuelve a guardar.";
  if (reason === "no_case") return "Todavía no hay un contacto.";
  if (reason === "missing") return "Esta propiedad ya no existe.";
  return "No se ha podido guardar.";
}

function fresh(id: string) {
  revalidatePath("/visitas");
  revalidatePath(`/visitas/${id}`);
  revalidatePath(`/propiedades/${id}`);
}

function version(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function optionalVersion(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (raw === "") return { ok: true as const, version: null };
  if (!/^\d+$/.test(raw)) return { ok: false as const };
  return { ok: true as const, version: Number(raw) };
}

function clock(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function day(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

async function actor() {
  const user = await currentUser();
  return userId(user.id);
}

async function home(formData: FormData) {
  const parsed = propertyId(String(formData.get("propertyId") ?? ""));
  if (!parsed.ok) return null;
  return parsed.id;
}

export async function noteAction(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const note = String(formData.get("nota") ?? "");
  const id = await home(formData);
  const seen = version(formData.get("caseVersion"));
  if (!id || seen === null) return { ok: false, message: RELOAD, note };
  if (note.length > NOTE_MAX) return { ok: false, message: "No se ha podido guardar.", note };
  const result = await act({ type: "note", propertyId: id, actorId: await actor(), text: note, caseVersion: seen });
  if (!result.ok) return { ok: false, message: say(result.reason), note };
  fresh(id);
  return { ok: true };
}

const EmailField = z.string().trim().min(1).max(200);

export async function emailAction(_prev: MailState, formData: FormData): Promise<MailState> {
  const typed = String(formData.get("correo") ?? "");
  const id = await home(formData);
  const seen = optionalVersion(formData.get("caseVersion"));
  if (!id || !seen.ok) return { ok: false, message: RELOAD, email: typed };
  const field = EmailField.safeParse(typed);
  const email = field.success ? emailAddress(field.data) : { ok: false as const };
  if (!email.ok) return { ok: false, message: "Esa dirección no es válida.", email: typed };
  const result = await act({
    type: "open",
    propertyId: id,
    contactEmail: email.email,
    actorId: await actor(),
    send: String(formData.get("enviar") ?? "") === "1",
    caseVersion: seen.version,
  });
  if (!result.ok) return { ok: false, message: say(result.reason), email: typed };
  fresh(id);
  return { ok: true };
}

const ConfirmFields = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inicio: z.string().regex(/^\d{2}:\d{2}/),
  fin: z.string().regex(/^\d{2}:\d{2}/),
});

export async function confirmAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const fecha = String(formData.get("fecha") ?? "");
  const inicio = String(formData.get("inicio") ?? "");
  const fin = String(formData.get("fin") ?? "");
  const fail = (message: string): ConfirmState => ({ ok: false, message, fecha, inicio, fin });
  const id = await home(formData);
  const seenCase = version(formData.get("caseVersion"));
  const seenStage = version(formData.get("stageVersion"));
  if (!id || seenCase === null || seenStage === null) return fail(RELOAD);
  const fields = ConfirmFields.safeParse({ fecha, inicio, fin });
  const date = day(fecha);
  const start = clock(inicio);
  const end = clock(fin);
  if (!fields.success || !date || !start || !end) return fail(BAD_CLOCK);
  const madrid = zone(ADVERTISER_ZONE);
  if (!madrid.ok) return fail("Esa zona horaria no existe.");
  const slot = wallInterval({
    year: date.year,
    month: date.month,
    day: date.day,
    startHour: start.hour,
    startMinute: start.minute,
    endHour: end.hour,
    endMinute: end.minute,
    zone: madrid.zone,
  });
  if (!slot.ok) return fail(slot.reason === "bad_range" ? LATER : BAD_CLOCK);
  const result = await act({
    type: "confirm",
    propertyId: id,
    actorId: await actor(),
    slot: slot.slot,
    stageVersion: seenStage,
    caseVersion: seenCase,
  });
  if (!result.ok) return fail(say(result.reason));
  fresh(id);
  return { ok: true };
}

export async function moveAction(_prev: MoveState, formData: FormData): Promise<MoveState> {
  const id = await home(formData);
  const seen = version(formData.get("caseVersion"));
  const to = String(formData.get("estado") ?? "");
  if (!id || seen === null) return { ok: false, message: RELOAD };
  if (to === "") return { ok: false, message: "Elige un estado." };
  if (!(VISIT_STATUSES as readonly string[]).includes(to)) return { ok: false, message: "No se ha podido guardar." };
  const result = await act({
    type: "move",
    propertyId: id,
    actorId: await actor(),
    to: to as VisitStatus,
    caseVersion: seen,
  });
  if (!result.ok) return { ok: false, message: say(result.reason) };
  fresh(id);
  return { ok: true };
}

export async function hoursAction(_prev: HoursState, formData: FormData): Promise<HoursState> {
  const named = zone(String(formData.get("zona") ?? ""));
  if (!named.ok) return { ok: false, message: "Esa zona horaria no existe." };
  const rules: FreeRule[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const from = String(formData.get(`semana-${weekday}-desde`) ?? "");
    const to = String(formData.get(`semana-${weekday}-hasta`) ?? "");
    if (from === "" && to === "") continue;
    const start = clock(from);
    const end = clock(to);
    if (!start || !end) return { ok: false, message: BAD_CLOCK };
    if (start.hour * 60 + start.minute >= end.hour * 60 + end.minute) return { ok: false, message: LATER };
    const rule = weeklyRule({
      weekday: weekday as Weekday,
      startHour: start.hour,
      startMinute: start.minute,
      endHour: end.hour,
      endMinute: end.minute,
      zone: named.zone,
    });
    if (!rule.ok) return { ok: false, message: BAD_CLOCK };
    rules.push(rule.rule);
  }
  const count = version(formData.get("tramos"));
  if (count === null || count > 24) return { ok: false, message: RELOAD };
  for (let i = 0; i < count; i++) {
    const fecha = String(formData.get(`tramo-${i}-fecha`) ?? "");
    const from = String(formData.get(`tramo-${i}-desde`) ?? "");
    const to = String(formData.get(`tramo-${i}-hasta`) ?? "");
    if (fecha === "" && from === "" && to === "") continue;
    const date = day(fecha);
    const start = clock(from);
    const end = clock(to);
    if (!date || !start || !end) return { ok: false, message: BAD_CLOCK };
    const rule = spanRule({
      year: date.year,
      month: date.month,
      day: date.day,
      startHour: start.hour,
      startMinute: start.minute,
      endHour: end.hour,
      endMinute: end.minute,
      zone: named.zone,
    });
    if (!rule.ok) return { ok: false, message: rule.reason === "bad_range" ? LATER : BAD_CLOCK };
    rules.push(rule.rule);
  }
  await act({ type: "save_rules", userId: await actor(), rules });
  revalidatePath("/ajustes");
  return { ok: true };
}
