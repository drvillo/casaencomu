import Link from "next/link";
import { notFound } from "next/navigation";
import { StageChip, VisitChip } from "@/components/propiedades/chip";
import { fmtDateTime } from "@/components/propiedades/format";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCase, MANUAL_TARGETS, propertyId, VISIT_LABELS } from "@/lib/visit";
import { ConfirmForm, EmailForm, MoveForm, NoteForm } from "../forms";

const h2 = "text-lg font-medium";

const PURPOSE = {
  ask: "Pregunta",
  confirm: "Confirmación",
  counter: "Otras horas",
  reply: "Respuesta",
} as const;

export default async function VisitaPage({ params }: { params: Promise<{ id: string }> }) {
  await currentUser();
  const { id } = await params;
  const parsed = propertyId(id);
  if (!parsed.ok) notFound();
  const found = await db.execute({ sql: "SELECT title FROM properties WHERE id = ?", args: [id] });
  if (!found.rows.length) notFound();
  const title = String(found.rows[0].title);
  const current = await loadCase(parsed.id);
  const options = current
    ? MANUAL_TARGETS[current.status].map((status) => ({ value: status, label: VISIT_LABELS[status] }))
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <Link href="/visitas" className="text-sm font-medium text-ink underline underline-offset-4">
          Visitas
        </Link>
        <h1 className="mt-3 text-[22px] font-medium leading-tight">{title}</h1>
        <Link href={`/propiedades/${id}`} className="mt-2 inline-block text-sm font-medium text-ink underline underline-offset-4">
          Ver el anuncio
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className={h2}>Anunciante</h2>
        {current ? null : <p className="text-body">Todavía no hay un contacto. Escribe la dirección y, si quieres, la primera carta.</p>}
        <EmailForm
          propertyId={id}
          caseVersion={current ? current.caseVersion : null}
          email={current ? current.contactEmail : ""}
          canSend={!current || current.status === "por_contactar" || current.status === "contactado"}
        />
      </section>

      {current ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <VisitChip status={current.status} />
            <StageChip stage={current.stage} />
          </div>
          {current.attention && <p className="text-body">Hay una respuesta nueva.</p>}
          {current.confirmed && (
            <p className="text-body">
              Hora confirmada: {fmtDateTime(current.confirmed.start)} a {fmtDateTime(current.confirmed.end)}.
            </p>
          )}
          {options.length > 0 && (
            <section className="space-y-3">
              <h2 className={h2}>Estado</h2>
              <MoveForm propertyId={id} caseVersion={current.caseVersion} options={options} />
            </section>
          )}
          <section className="space-y-3">
            <h2 className={h2}>Hora</h2>
            <ConfirmForm propertyId={id} caseVersion={current.caseVersion} stageVersion={current.stageVersion} />
          </section>
          <section className="space-y-3">
            <NoteForm propertyId={id} caseVersion={current.caseVersion} note={current.note} />
          </section>
          <section className="space-y-3">
            <h2 className={h2}>Mensajes</h2>
            {current.messages.length === 0 ? (
              <p className="text-muted">Todavía no hay mensajes.</p>
            ) : (
              <ol className="divide-y divide-hairline-soft border-y border-hairline-soft">
                {current.messages.map((message) => (
                  <li key={message.id} className="space-y-2 py-4">
                    <p className="text-sm text-muted">
                      {PURPOSE[message.purpose]} · {message.direction === "in" ? "Recibido" : message.sendState === "unsent" ? "Pendiente de envío" : "Enviado"} · {fmtDateTime(message.at)}
                    </p>
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-body">{message.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
