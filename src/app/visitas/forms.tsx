"use client";

import { useActionState } from "react";
import { input } from "@/components/propiedades/format";
import {
  confirmAction,
  emailAction,
  moveAction,
  noteAction,
  type ConfirmState,
  type MailState,
  type MoveState,
  type NoteState,
} from "./actions";

const button = "btn-primary h-12 rounded-lg px-5 text-base font-medium";
const quiet = "h-12 rounded-lg border border-ink px-5 text-base font-medium text-ink";

function statusOf(state: { ok: boolean; message?: string } | null) {
  if (!state) return null;
  if (state.ok) return <span className="text-ok">Guardado.</span>;
  return <span className="text-error">{state.message}</span>;
}

export function EmailForm({
  propertyId,
  caseVersion,
  email,
  canSend,
}: {
  propertyId: string;
  caseVersion: number | null;
  email: string;
  canSend: boolean;
}) {
  const [state, action, pending] = useActionState<MailState, FormData>(emailAction, null);
  const typed = state && !state.ok ? state.email : email;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      {caseVersion !== null && <input type="hidden" name="caseVersion" value={caseVersion} />}
      <label className="block space-y-1.5 text-sm font-medium text-ink">
        Correo del anunciante
        <input key={`correo-${typed}`} type="email" name="correo" required maxLength={200} defaultValue={typed} className={input} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="enviar" value="0" aria-busy={pending} className={quiet}>
          {pending ? "Guardando…" : "Guardar dirección"}
        </button>
        {canSend && (
          <button type="submit" name="enviar" value="1" aria-busy={pending} className={button}>
            {pending ? "Guardando…" : "Escribir al anunciante"}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {statusOf(state)}
      </p>
    </form>
  );
}

export function MoveForm({
  propertyId,
  caseVersion,
  options,
}: {
  propertyId: string;
  caseVersion: number;
  options: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<MoveState, FormData>(moveAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="caseVersion" value={caseVersion} />
      <label className="block space-y-1.5 text-sm font-medium text-ink">
        Estado del contacto
        <select name="estado" defaultValue="" className={input}>
          <option value="">Elige un estado</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" aria-busy={pending} className={button}>
        {pending ? "Guardando…" : "Guardar estado"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {statusOf(state)}
      </p>
    </form>
  );
}

export function ConfirmForm({
  propertyId,
  caseVersion,
  stageVersion,
}: {
  propertyId: string;
  caseVersion: number;
  stageVersion: number;
}) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmAction, null);
  const fecha = state && !state.ok ? state.fecha : "";
  const inicio = state && !state.ok ? state.inicio : "";
  const fin = state && !state.ok ? state.fin : "";
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="caseVersion" value={caseVersion} />
      <input type="hidden" name="stageVersion" value={stageVersion} />
      <p className="text-sm font-medium text-ink">Confirmar una hora</p>
      <p className="text-sm text-muted">Hora de Madrid. Puedes elegir una hora aunque no esté en los huecos del grupo.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input key={`fecha-${fecha}`} type="date" name="fecha" required defaultValue={fecha} aria-label="Día" className={input} />
        <input key={`inicio-${inicio}`} type="time" name="inicio" required defaultValue={inicio} aria-label="Desde" className={input} />
        <input key={`fin-${fin}`} type="time" name="fin" required defaultValue={fin} aria-label="Hasta" className={input} />
      </div>
      <button type="submit" aria-busy={pending} className={button}>
        {pending ? "Guardando…" : "Confirmar esta hora"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {statusOf(state)}
      </p>
    </form>
  );
}

export function NoteForm({ propertyId, caseVersion, note }: { propertyId: string; caseVersion: number; note: string }) {
  const [state, action, pending] = useActionState<NoteState, FormData>(noteAction, null);
  const typed = state && !state.ok ? state.note : note;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="caseVersion" value={caseVersion} />
      <label className="block space-y-1.5 text-sm font-medium text-ink">
        Nota
        <textarea
          key={`nota-${typed}`}
          name="nota"
          maxLength={2000}
          rows={4}
          defaultValue={typed}
          className="w-full rounded-lg border border-control-border bg-raised px-3 py-2 text-ink transition focus:border-ink"
        />
      </label>
      <p className="text-sm text-muted">Solo la veis vosotros.</p>
      <button type="submit" aria-busy={pending} className={button}>
        {pending ? "Guardando…" : "Guardar nota"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {statusOf(state)}
      </p>
    </form>
  );
}
