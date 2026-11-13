import { z } from "zod";

const int = z.number().int().nullish();
const str = z.string().nullish();
const bool = z.boolean().nullish();

/** Output of the extractor; only `title` is required. Description verbatim. */
export const Listing = z.object({
  title: z.string().min(1),
  price_eur: int,
  fees_eur: int,
  area_m2: int,
  rooms: int,
  bathrooms: int,
  floor: str,
  outdoor: str,
  condition: str,
  energy_rating: str,
  description: str,
  address_text: str,
  neighborhood: str,
  agency: str,
  lift: bool,
  parking: bool,
  address_precision: z.enum(["exact", "approx", "none"]).default("none"),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  photos: z.array(z.url()).default([]),
});
export type Listing = z.infer<typeof Listing>;

/**
 * What the family decided. Availability is deliberately not in this list (decision D07): whether
 * the advertisement is still up belongs to the source, and a portal delisting a home must not
 * overwrite `preseleccionada`. `no_disponible` was a stage until migration 3 retired it.
 */
export const STAGES = ["nueva", "revisando", "preseleccionada", "visita_prevista", "descartada"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  nueva: "Nueva",
  revisando: "Revisando",
  preseleccionada: "Preseleccionada",
  visita_prevista: "Visita prevista",
  descartada: "Descartada",
};

export const DIMENSIONS = [
  "ubicacion",
  "distribucion",
  "luz_vistas",
  "estado",
  "calidad_precio",
  "encaje_familiar",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABELS: Record<Dimension, string> = {
  ubicacion: "Ubicación",
  distribucion: "Distribución",
  luz_vistas: "Luz y vistas",
  estado: "Estado",
  calidad_precio: "Relación calidad-precio",
  encaje_familiar: "Encaje familiar",
};

export const EVENT_KINDS = [
  "import",
  // A link that was saved before it could be read has now been read. It is the moment the person
  // who pasted it has been waiting for, and until this existed nothing recorded it.
  "completed",
  "duplicate",
  "price_change",
  "availability_change",
  "facts_change",
  "enriched",
  "stage_change",
  "comment",
  "rating",
  // Content-free, both of them: the feed says somebody spoke, never what they said (#139).
  "opinion",
  "opinion_withdrawn",
  "visit_status",
  "visit_reply",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const SETTINGS_KEYS = ["presupuesto_min", "presupuesto_max", "presupuesto_por", "presupuesto_el"] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/**
 * Either bound alone is a budget. Requiring both meant a family that only knows its ceiling could
 * not say so, and could never take a figure off again (F30).
 */
export type Budget = { min: number | null; max: number | null };

/** `over` is unaffordable. `under` is only worth noticing, so it must not wear the same red (F30). */
export type Fit = "ok" | "over" | "under";

export function budgetFit(price: number | null, b: Budget | null): Fit {
  if (b === null || price === null) return "ok";
  if (b.max !== null && price > b.max) return "over";
  if (b.min !== null && price < b.min) return "under";
  return "ok";
}
