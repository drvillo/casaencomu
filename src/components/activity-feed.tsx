import Link from "next/link";
import { availabilityLine } from "@/lib/availability";
import type { Row } from "@/lib/activity";
import { STAGE_LABELS } from "@/lib/listing";
import { visitStatusClause } from "@/lib/visit-plan";
import { ago } from "./propiedades/format";

const eur = (n: unknown) => (typeof n === "number" ? `${n.toLocaleString("es-ES")} €` : "—");
const stage = (s: unknown) => (STAGE_LABELS as Record<string, string>)[String(s)] ?? String(s ?? "—");

export function line(e: Row) {
  const who = e.actor ?? "Alguien";
  const t = `«${e.title ?? "sin título"}»`;
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(e.payload_json ?? "{}") ?? {};
  } catch {
    // ponytail: unreadable payload → the line still renders, without the detail
  }
  switch (e.kind) {
    case "import":
      return `${who} añadió ${t}`;
    case "completed":
      // The advertisement was saved before anything could be read from it. Now it has been.
      return `Ya se ha leído el anuncio de ${t}`;
    case "duplicate":
      return `${who} volvió a guardar ${t}`;
    case "price_change":
      return `Precio de ${t}: ${eur(p.from)} → ${eur(p.to)}`;
    case "availability_change":
      // F04: this said "ya no está disponible" for every one of them, the `unknown` warnings
      // included, which is the opposite of what an unknown outcome means.
      return availabilityLine(String(p.to ?? ""), t);
    case "facts_change":
      return `Datos actualizados en ${t}`;
    case "enriched": {
      // Never "Datos actualizados": the advertisement did not change, our reading of it did.
      const n = (Array.isArray(p.read) ? p.read.length : 0) + (Array.isArray(p.inferred) ? p.inferred.length : 0);
      return `Se completaron ${n} dato${n === 1 ? "" : "s"} de ${t}`;
    }
    case "stage_change":
      return `${who} pasó ${t} a ${stage(p.to)}`;
    case "comment":
      return `${who} ${p.reply ? "respondió en" : "comentó en"} ${t}`;
    case "rating":
      return `${who} puntuó ${t}`;
    case "opinion":
      return `${who} publicó su opinión sobre ${t}`;
    case "opinion_withdrawn":
      return `${who} retiró su opinión sobre ${t}`;
    case "visit_status":
      return `${visitStatusClause(p)} · ${t}`;
    case "visit_reply":
      return `El anunciante respondió sobre ${t}`;
    default:
      return `${who}: ${e.kind} en ${t}`;
  }
}

const initial = (name: string | null) => (name ?? "?").trim().charAt(0).toUpperCase() || "?";

/**
 * The part of the home's page the line is about. A comment goes to the conversation, an opinion
 * to the opinions, a price or an availability change to the record of the advertisement — the
 * anchors the detail page carries since #153. Anything else lands at the top, which is right:
 * «alguien añadió este piso» is about the whole page.
 */
const WHERE: Record<string, string> = {
  comment: "#conversacion",
  rating: "#opiniones",
  opinion: "#opiniones",
  opinion_withdrawn: "#opiniones",
  stage_change: "#opinion",
  price_change: "#anuncio",
  availability_change: "#anuncio",
  facts_change: "#descripcion",
  enriched: "#descripcion",
};

/**
 * Everything that happened in this project, newest first. One component, shown in two places: the
 * «Actividad» tab of the bell menu, and the page behind «Ver todo».
 *
 * It reads nothing and writes nothing. The rows and the read marks are handed in, because the
 * page has to know which ids it drew in order to say that those, and only those, have been read
 * (PIP-13). Rendering used to be what marked them, and a prefetch renders.
 */
export default function ActivityFeed({
  rows,
  read,
  userId,
}: {
  rows: Row[];
  /** The ids this person has already read. Anything else by somebody else is «nuevo». */
  read: Set<string>;
  userId: string;
}) {
  if (rows.length === 0) return <p className="px-3 py-6 text-muted">Todavía no hay actividad.</p>;

  return (
    <ol className="divide-y divide-hairline-soft">
      {rows.map((e) => {
        const isNew = !read.has(e.id) && e.actor_id !== userId;
        return (
          // The anchor a deep link lands on, clear of the header that would otherwise cover it.
          <li key={e.id} id={`e-${e.id}`} className="scroll-mt-[calc(var(--header-h)+16px)]">
            <Link
              href={`/propiedades/${e.property_id}${WHERE[e.kind] ?? ""}`}
              className="flex min-h-11 items-start gap-3 rounded-lg px-3 py-3 transition hover:bg-surface-soft"
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  e.actor ? "bg-surface-strong text-ink" : "bg-accent-tint text-accent"
                }`}
                aria-hidden
              >
                {e.actor ? initial(e.actor) : "↻"}
              </span>
              <span className="flex-1 text-[15px] leading-snug">
                {isNew && (
                  <span className="mr-2 inline-block rounded-full bg-action px-2 py-0.5 align-middle text-[11px] font-semibold text-on-action">
                    nuevo
                  </span>
                )}
                {line(e)}
              </span>
              <time dateTime={e.created_at} className="shrink-0 pt-0.5 text-sm text-muted">
                {ago(e.created_at)}
              </time>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
