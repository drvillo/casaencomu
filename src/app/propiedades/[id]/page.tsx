import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, StageChip } from "@/components/propiedades/chip";
import { Conversation } from "@/components/propiedades/conversation";
import { fmtDate, fmtDateTime, fmtEur, fmtNum, SIN_DATOS, yesNo } from "@/components/propiedades/format";
import { Gallery } from "@/components/propiedades/gallery";
import { LocationMap } from "@/components/propiedades/location-map";
import { OpinionCards, Disagreements, type PublishedOpinion } from "@/components/propiedades/opinion-cards";
import { OpinionForm } from "@/components/propiedades/opinion-form";
import { PendingPoll } from "@/components/propiedades/pending-poll";
import { availabilityLine, AVAILABILITY_LABEL, isStale, propertyAvailability, type SourceAvailability } from "@/lib/availability";
import { CompareToggle, CompareTray } from "@/components/comparar/controls";
import { currentUser } from "@/lib/auth";
import { COMMENTS_SQL, thread, visible, type CommentRow } from "@/lib/comments";
import { currentProjectId, db } from "@/lib/db";
import { backHref } from "@/lib/filters";
import { DIMENSION_LABELS, DIMENSIONS, STAGE_LABELS, type Stage } from "@/lib/listing";
import { markReviewed } from "@/lib/notifications";
import { visitStatusClause } from "@/lib/visit-plan";
import { readMine } from "@/lib/opinions";
import { contributors, dimensionAverage, familyAverage, isPartial, matrix, memberAverage, type RatingRow } from "@/lib/ratings";


type Property = {
  id: string;
  title: string;
  stage: string;
  stage_version: number | null;
  price_eur: number | null;
  fees_eur: number | null;
  area_m2: number | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  lift: number | null;
  outdoor: string | null;
  parking: number | null;
  condition: string | null;
  energy_rating: string | null;
  description: string | null;
  address_text: string | null;
  address_precision: string;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
  created_at: string;
  /** 0 while nothing has been read from the advertisement: the title is a placeholder. */
  filled: number;
};
type Source = {
  portal: string;
  url_original: string;
  via: string;
  availability: SourceAvailability;
  /** Last attempt. `last_ok_at` is the last one that actually read the advertisement. */
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_check_outcome: string | null;
  /** Which layer produced each field: the portal, the AI reading the page, the AI deducing it. */
  field_origin_json: string | null;
};
type Event = { kind: string; payload_json: string | null; created_at: string; actor: string | null };
type Member = { id: string; name: string };
type MyRating = RatingRow & { updated_at: string };

const AVAILABILITY: Record<string, string> = AVAILABILITY_LABEL;
const PRECISION: Record<string, string> = { exact: "(exacta)", approx: "(aproximada)" };

/**
 * The link is saved and the record exists; this says why it is still empty. Written after the
 * fact, on the page, so it survives a reload — the message under the add field is gone by then.
 */
const PENDING: Record<string, string> = {
  blocked:
    "El enlace está guardado. Este portal no deja leerlo desde el servidor. Abre el anuncio y usa el marcador de Ajustes para completarlo.",
  offline: "El enlace está guardado. No se pudo descargar la página. Puedes volver a pegarlo o usar el marcador de Ajustes.",
  offsite: "El enlace lleva fuera del portal, así que no se pudo leer. Ábrelo y pulsa el marcador.",
  unreadable: "El enlace está guardado. No se pudo leer la página. Abre el anuncio y usa el marcador de Ajustes para completarlo.",
  removed: "El anuncio ya no está publicado, así que no hay datos que leer. El enlace queda guardado.",
  default: "Todavía no se ha leído este anuncio. El enlace está guardado.",
};
const stageLabel = (s: unknown) => STAGE_LABELS[s as Stage] ?? String(s ?? "?");

function parse(json: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(json ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** One Spanish line per `events` row. */
function describe(kind: string, p: Record<string, unknown>) {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  switch (kind) {
    case "import":
      return `Guardada${typeof p.portal === "string" ? ` desde ${p.portal}` : ""}`;
    case "duplicate":
      return "Ya estaba guardada (intento repetido)";
    case "price_change":
      return `Precio: ${fmtEur(num(p.from))} → ${fmtEur(num(p.to))}`;
    case "availability_change":
      return availabilityLine(String(p.to), "Este anuncio").replace("Este anuncio: ", "");
    case "facts_change":
      return "Datos del anuncio actualizados";
    case "enriched": {
      // Never "Datos actualizados": the advertisement did not change, our reading of it did.
      const n = (Array.isArray(p.read) ? p.read.length : 0) + (Array.isArray(p.inferred) ? p.inferred.length : 0);
      return `Se completaron ${n} dato${n === 1 ? "" : "s"} que faltaban`;
    }
    case "stage_change":
      return `Etapa: ${stageLabel(p.from)} → ${stageLabel(p.to)}`;
    case "comment":
      // No words, ever. The payload never held them after #146 and the migration took them out of
      // the ones that did: a comment somebody removed must not stay readable here (V21).
      return p.reply ? "Respuesta en la conversación" : "Comentario nuevo";
    case "rating":
      return "Valoración guardada";
    case "opinion":
      return "Opinión publicada";
    case "opinion_withdrawn":
      return "Opinión retirada";
    case "visit_status":
      return visitStatusClause(p);
    case "visit_reply":
      return "Respuesta del anunciante";
    default:
      return kind;
  }
}

const h2 = "text-[22px] font-medium leading-tight";
const band = "mt-12";
/** The record of the advertisement, not the conversation about it. Smaller, and never an `h2`
 * that competes with «Descripción» or «Tu opinión» (F36). */
const hRecord = "text-sm font-semibold uppercase tracking-wide text-muted";
const cell = "border-b border-hairline-soft py-2 pr-3 align-top";
const score = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtScore = (n: number | null) => (n === null ? "—" : score(n));

export default async function PropiedadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const estado = one(sp.estado);
  // The list this home was opened from. Rebuilt through the filter contract before it is used,
  // so a hand-edited value can only ever produce a list URL (F14).
  const desde = one(sp.desde) ?? "";
  const faltan = Number(one(sp.faltan) ?? 0);
  /** Whose opinion «Responder» was pressed on. Checked against the published authors below. */
  const responder = one(sp.responder) ?? null;
  const user = await currentUser();

  // ponytail: one batch, eight statements, no joins to untangle
  const [prop, photos, sources, events, ratings, comments, members, opinions] = await db.batch(
    [
      { sql: "SELECT * FROM properties WHERE id = ?", args: [id] },
      { sql: "SELECT id FROM photos WHERE property_id = ? ORDER BY position", args: [id] },
      { sql: "SELECT portal, url_original, via, availability, last_checked_at, last_ok_at, last_check_outcome, field_origin_json FROM sources WHERE property_id = ? ORDER BY first_seen_at", args: [id] },
      {
        sql: "SELECT e.kind, e.payload_json, e.created_at, u.name AS actor FROM events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.property_id = ? ORDER BY e.created_at DESC",
        args: [id],
      },
      { sql: "SELECT user_id, dimension, score, updated_at FROM ratings WHERE property_id = ?", args: [id] },
      { sql: COMMENTS_SQL, args: [id] },
      "SELECT id, name FROM users ORDER BY created_at",
      // Published and not withdrawn: the only opinions that exist for anyone but their author.
      {
        sql: `SELECT o.user_id, o.stance, o.reasoning, o.blocker, o.basis, o.published_at, o.updated_at, u.name
              FROM opinions o JOIN users u ON u.id = o.user_id
              WHERE o.property_id = ? AND o.withdrawn = 0`,
        args: [id],
      },
    ],
    "read",
  );
  const p = prop.rows[0] as unknown as Property | undefined;
  if (!p) notFound();

  // Opening it is reviewing it: this is what takes the home off «Por revisar» for this person.
  // After `notFound()`, so a link to something that is gone never counts as having looked at it.
  await markReviewed(user.id, p.id);

  const photoIds = photos.rows.map((r) => String(r.id));
  const sourceRows = sources.rows as unknown as Source[];
  const eventRows = (events.rows as unknown as Event[]).map((e) => ({ ...e, payload: parse(e.payload_json) }));
  const priceHistory = eventRows.filter((e) => e.kind === "price_change");
  const ratingRows = ratings.rows as unknown as MyRating[];
  const conversation = thread(comments.rows as unknown as CommentRow[]);
  const talk = visible(conversation);
  const memberRows = members.rows as unknown as Member[];
  const opinionRows = opinions.rows as unknown as PublishedOpinion[];
  const silent = memberRows.filter((u) => !opinionRows.some((o) => o.user_id === u.id));
  /**
   * The table is «who put numbers on this home», not «everybody with an account». A person who
   * has never scored anything used to take a whole column of dashes: with seven accounts on the
   * server and ten allowed, that is what makes the grid unreadable on a telephone.
   */
  const scoringMembers = memberRows.filter((u) => ratingRows.some((r) => r.user_id === u.id));
  const m = matrix(ratingRows, scoringMembers.map((u) => u.id), DIMENSIONS);
  /**
   * Answering one person: the conversation, with them already chosen. Every other parameter is
   * carried through, so the back link still knows which list the reader came from.
   */
  const projectId = await currentProjectId();
  /** That person, everywhere: what they said about every home in this project. */
  const personHref = (userId: string) => `/proyectos/${projectId}/persona/${userId}`;
  const replyHref = (userId: string) => {
    const q = new URLSearchParams();
    if (desde) q.set("desde", desde);
    if (estado) q.set("estado", estado);
    q.set("responder", userId);
    return `/propiedades/${p.id}?${q}#conversacion`;
  };
  const family = familyAverage(ratingRows);
  const perM2 = p.price_eur !== null && p.area_m2 ? fmtEur(Math.round(p.price_eur / p.area_m2)) : null;

  // The state column of the opinion box: what the advertisement is doing, and when each of us
  // last said something here.
  const availability = propertyAvailability(sourceRows);
  const lastChecked = sourceRows.map((s) => s.last_ok_at).filter(Boolean).sort().at(-1) ?? null;
  const mineAt = ratingRows.filter((r) => r.user_id === user.id).map((r) => r.updated_at).sort().at(-1) ?? null;
  // The author's own opinion and unsent draft. Nobody else's draft is read here or anywhere.
  const mine = await readMine(id, user.id);
  const voices = contributors(ratingRows);
  // Somebody answered part of the form, so the family number is thinner than it looks (#130).
  const partial = isPartial(ratingRows, DIMENSIONS.length);

  // `null` is «the advertisement does not say», and it is a different thing from a value. Twelve
  // rows of «Sin datos» is what this used to print, and on a real listing seven of them were that
  // (F35): the panel now carries what is known, and one sentence names the rest.
  const facts: [string, string | null, string][] = [
    ["Superficie", p.area_m2 === null ? null : fmtNum(p.area_m2, "m²"), "area_m2"],
    ["Habitaciones", p.rooms === null ? null : fmtNum(p.rooms), "rooms"],
    ["Baños", p.bathrooms === null ? null : fmtNum(p.bathrooms), "bathrooms"],
    ["Planta", p.floor, "floor"],
    ["Ascensor", yesNo(p.lift), "lift"],
    ["Exterior", p.outdoor, "outdoor"],
    ["Parking", yesNo(p.parking), "parking"],
    ["Estado", p.condition, "condition"],
    ["Certificado energético", p.energy_rating, "energy_rating"],
    ["Honorarios", p.fees_eur === null ? null : fmtEur(p.fees_eur), "fees_eur"],
    ["Barrio", p.neighborhood, "neighborhood"],
    ["Dirección", p.address_text ? `${p.address_text} ${PRECISION[p.address_precision] ?? ""}`.trim() : null, "address_text"],
  ];
  const known = facts.filter(([, v]) => v !== null) as [string, string, string][];
  // Lower case, because they are being read as a sentence and not as labels of a table.
  const missing = facts.filter(([, v]) => v === null).map(([k]) => k[0].toLowerCase() + k.slice(1));
  const advert = sourceRows.find((s) => /^https?:\/\//.test(s.url_original));
  // A deduced value is not a fact the advertisement states, and the two must never look alike.
  // Only layer 3 is marked: layer 2 copies words that are on the page, which the portal's own
  // extractor simply failed to find.
  const origin: Record<string, string> = Object.assign({}, ...sourceRows.map((s) => parse(s.field_origin_json)));
  const deduced = (key: string) => origin[key] === "ai_inferred";
  const summary = [p.neighborhood, p.area_m2 !== null && fmtNum(p.area_m2, "m²"), p.rooms !== null && `${p.rooms} hab.`, p.bathrooms !== null && `${p.bathrooms} baños`]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
    <div className="mx-auto max-w-[1120px] px-4 py-5 sm:px-6 lg:px-10">
      <div className="flex items-center justify-between gap-3">
      <Link href={backHref(desde, p.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink transition hover:bg-surface-soft">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Propiedades
      </Link>
        <CompareToggle userId={user.id} id={p.id} label={p.title} />
      </div>
      <CompareTray userId={user.id} visible={[p.id]} />

      {/* What the import just did. A second look at a known advertisement is a refresh, not a
          rejected duplicate, so it says whether anything actually changed. */}
      {estado === "igual" && (
        <p className="mt-4 rounded-lg bg-ok-tint px-4 py-3 text-sm text-ok">Ya la teníamos. Sin cambios en el anuncio.</p>
      )}
      {estado === "actualizada" && (
        <p className="mt-4 rounded-lg bg-ok-tint px-4 py-3 text-sm text-ok">Ya la teníamos. Datos actualizados.</p>
      )}
      {faltan > 0 && (
        <p className="mt-2 rounded-lg bg-accent-tint px-4 py-3 text-sm text-body">
          {faltan === 1 ? "No se pudo guardar 1 foto." : `No se pudieron guardar ${faltan} fotos.`} Vuelve a comprobar el
          anuncio para intentarlo otra vez.
        </p>
      )}

      {!p.filled && (
        <div className="mt-4 rounded-lg bg-accent-tint px-4 py-3 text-sm text-body">
          <p>{PENDING[sourceRows[0]?.last_check_outcome ?? ""] ?? PENDING.default}</p>
          {sourceRows[0]?.last_check_outcome !== "removed" && (
            <Link href="/ajustes#anadir-piso" className="mt-2 inline-block font-medium text-ink underline underline-offset-4">Cómo completar el anuncio</Link>
          )}
          {sourceRows[0]?.last_check_outcome !== "removed" && <PendingPoll />}
        </div>
      )}

      {/* The price sits with the title, where a person looks for it, and not in a card halfway
          down the page (PIP-07). */}
      <header className="mt-4 space-y-1">
        <h1 className="text-[22px] font-medium leading-tight sm:text-[26px]">{p.title}</h1>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[22px] font-semibold leading-tight text-ink">{fmtEur(p.price_eur, "Sin precio")}</p>
          {perM2 && <p className="text-sm text-muted">{perM2}/m²</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-body">
          {summary && <span>{summary}</span>}
          <StageChip stage={p.stage} />
          <Link href={`/visitas/${p.id}`} className="font-medium text-ink underline underline-offset-4">
            Contacto con el anunciante
          </Link>
          <span className="text-muted">{family !== null ? `★ ${score(family)} en familia` : "Sin valorar"}</span>
        </div>
      </header>

      {photoIds.length > 0 && <Gallery ids={photoIds} title={p.title} />}

      {/* ---- band 1: the advertisement's own words, and the facts beside them ---- */}
      <section id="descripcion" className={`${band} scroll-mt-[calc(var(--header-h)+16px)] grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12`}>
        <div>
          <h2 className={h2}>Descripción</h2>
          {p.description ? (
            <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-body">{p.description}</p>
          ) : (
            <p className="mt-4 text-sm text-muted">Sin descripción.</p>
          )}
        </div>
        <aside className="lg:col-start-2 lg:row-start-1">
          <div className="bento">
            <h2 className="mb-2 text-sm font-semibold text-ink">Datos</h2>
            {known.length > 0 && (
              <dl>
                {known.map(([k, val, key]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-hairline-soft py-2.5 text-sm last:border-0">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right font-medium text-ink">
                      {val}
                      {deduced(key) && <span className="ml-1.5 text-[11px] font-normal text-muted">deducido</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {known.some(([, , key]) => deduced(key)) && (
              <p className="mt-3 text-xs text-muted">
                «deducido» lo ha completado la IA a partir del texto o de las fotos. El anuncio no lo dice.
              </p>
            )}

            {/* What is not known, named once instead of repeated down a column. A home nobody has
                read yet is a different sentence: there is nothing missing, there is nothing yet. */}
            {missing.length > 0 && (
              <div className={known.length ? "mt-4 border-t border-hairline-soft pt-3" : ""}>
                {p.filled ? (
                  <>
                    <p className="text-xs leading-relaxed text-muted">
                      <span className="font-semibold text-body">No consta:</span> {missing.join(", ")}.
                    </p>
                    {advert && (
                      <a
                        href={advert.url_original}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="touch-target mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink underline underline-offset-4"
                      >
                        Míralo en <span className="capitalize">{advert.portal}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M7 17L17 7M9 7h8v8" />
                        </svg>
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-xs leading-relaxed text-muted">Todavía no se ha leído el anuncio.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </section>

      {/* ---- band 2: one box, one button ---- */}
      <section id="opinion" className={`${band} scroll-mt-[calc(var(--header-h)+16px)]`}>
        <h2 className={h2}>Tu opinión</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Tu opinión se publica aparte, cuando tú quieras. La etapa se guarda con el botón de abajo, y es la de todos.
        </p>
        <OpinionForm key={`${user.email}:${projectId}:${p.id}`} owner={{ accountId: user.email, projectId }} propertyId={p.id} mine={mine} stage={p.stage} version={Number(p.stage_version ?? 0)}>
          <dl className="space-y-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-muted">Anuncio</dt>
              <dd>
                <Chip tone={availability === "active" ? "success" : availability === "unknown" ? "warning" : "danger"}>
                  {AVAILABILITY[availability] ?? availability}
                </Chip>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Comprobado</dt>
              <dd className="text-body">{lastChecked ? fmtDateTime(lastChecked) : "Nunca"}</dd>
            </div>
            <div>
              <dt className="text-muted">Tus respuestas</dt>
              <dd className="text-body">{mineAt ? fmtDate(mineAt) : "Todavía no has valorado"}</dd>
            </div>
            <div>
              <dt className="text-muted">La familia</dt>
              <dd className="text-body">
                {voices === 0 ? "Nadie ha valorado" : voices === 1 ? "1 persona ha valorado" : `${voices} personas han valorado`}
                {partial ? " (parcial)" : ""}
                {` · ${talk} ${talk === 1 ? "comentario" : "comentarios"}`}
              </dd>
            </div>
          </dl>
        </OpinionForm>
      </section>

      {/* ---- band 3: the table, and the conversation beside it ---- */}
      <section id="opiniones" className={`${band} scroll-mt-[calc(var(--header-h)+16px)]`}>
        <h2 className={h2}>Lo que opina la familia</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          {opinionRows.length === 0
            ? "Nadie ha opinado todavía."
            : `${opinionRows.length} ${opinionRows.length === 1 ? "persona ha opinado" : "personas han opinado"}` +
              (voices > 0 ? ` · ${voices} con puntuaciones${partial ? " · Parcial" : ""}` : "")}
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-4">
            {/* What each person wrote comes before any grid of numbers: the numbers summarise
                this, not the other way round (doc 04 § 5). */}
            <OpinionCards opinions={opinionRows} ratings={ratingRows} readerId={user.id} silent={silent} replyHref={replyHref} personHref={personHref} />
            <Disagreements opinions={opinionRows} ratings={ratingRows} readerId={user.id} replyHref={replyHref} />
            {ratingRows.length === 0 ? (
              // Six rows of dashes say nothing that this one line does not say better.
              <p className="bento text-sm text-muted">
                Nadie ha puntuado los aspectos todavía. Las puntuaciones se ponen en «Tu opinión», y son opcionales.
              </p>
            ) : (
            <div className="bento overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="mb-2 text-left text-xs text-muted">
                  Solo las personas que han puntuado. Una opinión sin puntuaciones se lee arriba.
                </caption>
                <thead>
                  <tr>
                    <th className={`${cell} text-left font-medium text-muted`}>Aspecto</th>
                    {scoringMembers.map((u) => (
                      <th key={u.id} className={`${cell} text-center font-medium ${u.id === user.id ? "text-ink" : "text-muted"}`}>
                        {u.id === user.id ? "Tú" : u.name}
                      </th>
                    ))}
                    <th className={`${cell} text-center font-medium text-muted`}>Media</th>
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((dim) => {
                    const dimRows = ratingRows.filter((r) => r.dimension === dim);
                    return (
                      <tr key={dim}>
                        <th scope="row" className={`${cell} text-left font-normal text-body`}>
                          {DIMENSION_LABELS[dim]}
                        </th>
                        {scoringMembers.map((u) => (
                          <td key={u.id} className={`${cell} text-center`}>
                            {m[u.id][dim] ?? "—"}
                          </td>
                        ))}
                        <td className={`${cell} text-center font-medium`}>{fmtScore(dimensionAverage(dimRows))}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row" className={`${cell} text-left font-medium`}>
                      Media
                    </th>
                    {scoringMembers.map((u) => (
                      <td key={u.id} className={`${cell} text-center font-medium`}>
                        {fmtScore(memberAverage(ratingRows, u.id))}
                      </td>
                    ))}
                    <td className={`${cell} text-center font-semibold`}>
                      {fmtScore(family)}
                      {partial && <span className="block text-xs font-normal text-muted">Parcial</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div id="conversacion" className="bento flex flex-col scroll-mt-[calc(var(--header-h)+16px)]">
            <p className="mb-3 text-sm font-semibold text-ink">Comentarios</p>
            {/* Oldest first now, and the box at the foot. The pane used to be newest-first, which
                a thread cannot be: an answer would arrive above the comment it answers. */}
            <Conversation
              key={`${user.email}:${projectId}:${p.id}`}
              owner={{ accountId: user.email, projectId }}
              propertyId={p.id}
              nodes={conversation}
              viewerId={user.id}
              voices={opinionRows.map((o) => ({ id: o.user_id, name: o.name }))}
              about={responder}
            />
          </div>
        </div>
      </section>
    </div>

    {/* ---- band 4: where it is, at the full width of the window and much wider than it is tall.
        It sits outside the container rather than breaking out of it with a viewport width, which
        would add a horizontal scrollbar of exactly the vertical scrollbar's width. ---- */}
    <section className="mt-12 border-t border-hairline-soft">
      <div className="mx-auto max-w-[1120px] px-4 pb-3 pt-8 sm:px-6 lg:px-10">
        <h2 className={h2}>Dónde está</h2>
        <p className="mt-1 text-sm text-muted">
          {p.address_text ?? p.neighborhood ?? "Sin dirección en el anuncio"}
          {p.address_precision === "approx" && " · ubicación aproximada: la zona, no el portal"}
          {p.address_precision === "exact" && " · ubicación exacta"}
        </p>
      </div>
      {p.lat !== null && p.lng !== null && p.address_precision !== "none" ? (
        <div className="location-strip">
          <LocationMap lat={p.lat} lng={p.lng} precision={p.address_precision === "exact" ? "exact" : "approx"} />
        </div>
      ) : (
        <div className="mx-auto max-w-[1120px] px-4 pb-10 sm:px-6 lg:px-10">
          <p className="rounded-card bg-sunken px-4 py-6 text-sm text-muted">
            El anuncio no da coordenadas, así que no se puede situar en el mapa.
          </p>
        </div>
      )}
    </section>

    {/* ---- the record of the advertisement. Not the family's conversation about it, so it does
           not carry the same headings as the conversation (F36). One block, one small heading,
           and the history behind a fold that the browser opens with no script of ours. ---- */}
    <div className="mx-auto max-w-[1120px] px-4 pb-14 sm:px-6 lg:px-10">
      <section id="anuncio" className="mt-12 scroll-mt-[calc(var(--header-h)+16px)] border-t border-hairline-soft pt-8">
        <h2 className={hRecord}>El anuncio</h2>
        {sourceRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{SIN_DATOS}</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {sourceRows.map((s) => {
              const check = s.via === "bookmarklet" || s.availability === "unknown";
              return (
                <li key={s.url_original} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="font-medium capitalize text-ink">{s.portal}</span>
                  {/^https?:\/\//.test(s.url_original) && (
                    <a href={s.url_original} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-4">
                      Ver anuncio
                    </a>
                  )}
                  <Chip tone={s.availability === "active" ? "success" : s.availability === "unknown" ? "warning" : "danger"}>
                    {AVAILABILITY[s.availability] ?? s.availability}
                  </Chip>
                  {s.availability === "active" && isStale(s.last_ok_at, new Date()) && (
                    <Chip tone="warning">Sin comprobar hace más de 48 h</Chip>
                  )}
                  {/* two different facts: when we last tried, and when we last succeeded */}
                  <span className="text-xs text-muted">
                    vía {s.via === "bookmarklet" ? "marcador" : s.via} · comprobado{" "}
                    {s.last_checked_at ? fmtDateTime(s.last_checked_at) : "nunca"} · visto bien{" "}
                    {s.last_ok_at ? fmtDateTime(s.last_ok_at) : "nunca"}
                  </span>
                  {check && (
                    <span className="text-warning-ink">
                      <Chip tone="warning">Comprobar</Chip> Abre el anuncio y vuelve a pulsar el marcador.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ponytail: a native <details>. The browser already opens, closes and finds text inside
            one, and none of that is worth a client component. */}
        <details className="group mt-6">
          <summary className="touch-target inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-body transition hover:text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition group-open:rotate-90" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
            Historial de precio y actividad
            {priceHistory.length + eventRows.length > 0 && (
              <span className="text-muted">({priceHistory.length + eventRows.length})</span>
            )}
          </summary>

          <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <h3 className={hRecord}>Historial de precio</h3>
              {priceHistory.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Sin cambios de precio.</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {priceHistory.map((e, i) => (
                    <li key={i}>
                      <span className="text-muted">{fmtDate(e.created_at)}:</span> {describe(e.kind, e.payload)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className={hRecord}>Actividad</h3>
              {eventRows.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Sin actividad.</p>
              ) : (
                <ol className="relative mt-3 space-y-4 border-l border-hairline pl-5 text-sm">
                  {eventRows.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-raised bg-accent" aria-hidden />
                      <div className="text-muted">
                        {fmtDateTime(e.created_at)}
                        {e.actor && ` · ${e.actor}`}
                      </div>
                      <div className="text-body">{describe(e.kind, e.payload)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </details>
      </section>
    </div>
    </>
  );
}
