import { AVAILABILITY_LABEL, type SourceAvailability } from "@/lib/availability";
import { STAGE_LABELS, type Stage } from "@/lib/listing";
import { VISIT_LABELS, type VisitStatus } from "@/lib/visit-plan";

/**
 * Status colour comes from the theme tokens, never from a Tailwind palette utility. `bg-sky-100`
 * and friends are the same pale colour in both themes, so a night-mode badge used to sit as a
 * near-white block on a dark card (F08). Roles: `docs/product-improvement/03-design-motion-map.md`
 * § 2, status mapping.
 */
const TONES = {
  neutral: "bg-surface-strong text-body",
  info: "bg-info-bg text-info-ink",
  warning: "bg-warning-bg text-warning-ink",
  success: "bg-success-bg text-success-ink",
  visit: "bg-visit-bg text-visit-ink",
  danger: "bg-danger-bg text-danger-ink",
  selection: "bg-selection-bg text-selection-ink",
} as const;
type Tone = keyof typeof TONES;

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STAGE_TONE: Record<Stage, Tone> = {
  nueva: "info",
  revisando: "warning",
  preseleccionada: "success",
  visita_prevista: "visit",
  descartada: "neutral",
};

/**
 * A shape beside the word, so the stage is never carried by colour alone. Drawn with a border and
 * a path rather than a fill, so it inherits the chip's text colour and stays legible in both themes.
 */
const STAGE_MARK: Record<Stage, string> = {
  nueva: "M12 7a5 5 0 100 10 5 5 0 000-10z", // outlined dot
  revisando: "M9.2 9.2a2.8 2.8 0 115.3 1.3c-.5.9-1.6 1.3-2.2 2-.3.4-.3.9-.3 1.3M12 17.6v.1", // question mark
  preseleccionada: "M6 12.5l4 4 8-8.5", // check
  visita_prevista: "M5 7h14v13H5zM5 11h14M9 4v4M15 4v4", // calendar
  descartada: "M7 12h10", // minus
};

const Mark = ({ stage }: { stage: Stage }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={STAGE_MARK[stage]} />
  </svg>
);

const VISIT_TONE: Record<VisitStatus, Tone> = {
  por_contactar: "neutral",
  contactado: "info",
  esperando_respuesta: "warning",
  no_sigue: "neutral",
  visita_propuesta: "warning",
  visita_confirmada: "visit",
  visitada: "success",
  rechazada: "danger",
};

export function VisitChip({ status }: { status: VisitStatus }) {
  return <Chip tone={VISIT_TONE[status]}>{VISIT_LABELS[status]}</Chip>;
}

export function StageChip({ stage }: { stage: string }) {
  const s = stage as Stage;
  if (!STAGE_TONE[s]) return <Chip>{stage}</Chip>;
  return (
    <Chip tone={STAGE_TONE[s]}>
      <Mark stage={s} />
      {STAGE_LABELS[s]}
    </Chip>
  );
}

/** Dot colour per stage, for the stage strip. Tokens, so both themes get a visible dot. */
export const STAGE_DOT: Record<Stage, string> = {
  nueva: "bg-info-ink",
  revisando: "bg-warning-ink",
  preseleccionada: "bg-success-ink",
  visita_prevista: "bg-visit-ink",
  descartada: "bg-muted",
};

/** White pill that floats on a photo (Airbnb's "Guest favorite" badge). */
export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-raised/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-tier ${className}`}
    >
      {children}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const s = stage as Stage;
  if (!STAGE_TONE[s]) return <Badge>{stage}</Badge>;
  return (
    <Badge>
      <span className={`h-2 w-2 rounded-full ${STAGE_DOT[s]}`} aria-hidden />
      {STAGE_LABELS[s]}
    </Badge>
  );
}

export const BudgetChip = () => <Chip tone="danger">Fuera de presupuesto</Chip>;

/**
 * Whether the advertisement is still up. Separate from the stage on purpose (D07), so the two are
 * never confused: this one says what the portal is doing, the stage says what the family decided.
 */
export function AvailabilityChip({ availability, stale }: { availability: SourceAvailability; stale?: boolean }) {
  if (availability === "active" && !stale) return null; // the ordinary case needs no label
  if (availability === "active") return <Chip tone="warning">Sin comprobar hace más de 48 h</Chip>;
  return (
    <Chip tone={availability === "removed" ? "danger" : "warning"}>{AVAILABILITY_LABEL[availability]}</Chip>
  );
}
