"use client";

import { useActionState } from "react";
import { input } from "@/components/propiedades/format";
import { hoursAction, type HoursState } from "@/app/visitas/actions";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export type HoursInitial = {
  zoneName: string;
  days: { inicio: string; fin: string }[];
  spans: { fecha: string; inicio: string; fin: string }[];
};

export function Disponibilidad({ initial }: { initial: HoursInitial }) {
  const [state, action, pending] = useActionState<HoursState, FormData>(hoursAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium text-ink">
        Zona horaria
        <input name="zona" required defaultValue={initial.zoneName} spellCheck={false} aria-label="Zona horaria" className={input} />
      </label>
      <div className="space-y-2">
        {DAYS.map((label, index) => {
          const weekday = index + 1;
          const row = initial.days[index] ?? { inicio: "", fin: "" };
          return (
            <div key={label} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_1fr]">
              <span className="text-sm font-medium text-ink">{label}</span>
              <input type="time" name={`semana-${weekday}-desde`} defaultValue={row.inicio} aria-label={`${label}, desde`} className={input} />
              <input type="time" name={`semana-${weekday}-hasta`} defaultValue={row.fin} aria-label={`${label}, hasta`} className={input} />
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Días sueltos</p>
        <p className="text-sm text-muted">El último tramo vacío no se guarda.</p>
        {initial.spans.map((span, index) => (
          <div key={`${span.fecha}-${index}`} className="grid gap-2 sm:grid-cols-3">
            <input type="date" name={`tramo-${index}-fecha`} defaultValue={span.fecha} aria-label={`Tramo ${index + 1}, día`} className={input} />
            <input type="time" name={`tramo-${index}-desde`} defaultValue={span.inicio} aria-label={`Tramo ${index + 1}, desde`} className={input} />
            <input type="time" name={`tramo-${index}-hasta`} defaultValue={span.fin} aria-label={`Tramo ${index + 1}, hasta`} className={input} />
          </div>
        ))}
        <input type="hidden" name="tramos" value={initial.spans.length} />
      </div>
      <button type="submit" aria-busy={pending} className="btn-primary h-12 rounded-lg px-5 text-base font-medium">
        {pending ? "Guardando…" : "Guardar"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state?.ok && <span className="text-ok">Guardado.</span>}
        {state && !state.ok && <span className="text-error">{state.message}</span>}
      </p>
    </form>
  );
}
