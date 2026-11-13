import Link from "next/link";
import { Cover } from "@/components/propiedades/card";
import { StageChip, VisitChip } from "@/components/propiedades/chip";
import { fmtDateTime, fmtEur, fmtNum } from "@/components/propiedades/format";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { board } from "@/lib/visit";

export default async function VisitasPage() {
  await currentUser();
  const rows = await board();
  const covers = new Map<string, string>();
  if (rows.length) {
    const photos = await db.execute({
      sql: `SELECT property_id, id FROM photos WHERE property_id IN (${rows.map(() => "?").join(",")}) ORDER BY position, id`,
      args: rows.map((row) => row.propertyId),
    });
    for (const photo of photos.rows) {
      const property = String(photo.property_id);
      if (!covers.has(property)) covers.set(property, String(photo.id));
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-14">
      <h1 className="text-[22px] font-medium">Visitas</h1>
      <p className="mt-2 text-body">El contacto con los anunciantes de los pisos que queréis ver.</p>
      {rows.length === 0 ? (
        <p className="mt-8 text-muted">Todavía no hay contactos con anunciantes.</p>
      ) : (
        <ul className="mt-8 divide-y divide-hairline-soft">
          {rows.map((row) => {
            const meta = [row.areaM2 !== null && fmtNum(row.areaM2, "m²"), row.rooms !== null && `${row.rooms} hab.`]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={row.propertyId} className="py-5 first:pt-0 last:pb-0">
                <div className="flex gap-4 sm:gap-5">
                  <Link href={`/visitas/${row.propertyId}`} tabIndex={-1} aria-hidden className="block w-32 shrink-0 sm:w-56">
                    <div className="aspect-[3/2] overflow-hidden rounded-card bg-surface-soft">
                      <Cover id={covers.get(row.propertyId) ?? null} className="card-photo h-full w-full" />
                    </div>
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm text-muted">{row.neighborhood ?? "Sin barrio"}</p>
                    <Link href={`/visitas/${row.propertyId}`} className="mt-0.5 block">
                      <h2 className="line-clamp-2 text-[15px] font-medium text-ink">{row.title}</h2>
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted">{meta || "Sin datos"}</p>
                    {row.confirmed && (
                      <p className="mt-1 text-sm text-body">
                        {fmtDateTime(row.confirmed.start)} a {fmtDateTime(row.confirmed.end)}
                      </p>
                    )}
                    <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <VisitChip status={row.status} />
                        <StageChip stage={row.stage} />
                        {row.attention && <span className="text-sm font-medium text-ink">Necesita atención</span>}
                      </div>
                      <p className="text-[15px] font-semibold text-ink">{fmtEur(row.priceEur, "Sin precio")}</p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
