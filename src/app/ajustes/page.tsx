import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { buildBookmarklet } from "@/lib/bookmarklet";
import { PORTALS } from "@/lib/url";
import { input } from "@/components/propiedades/format";
import { ClaveForm } from "./clave";
import RecoveryCodeForm from "./recovery";
import { PERSON_NAME_MAX } from "@/lib/project-shape";
import { CopyBox } from "./copy";
import { renombrarseAction } from "./actions";
import { Disponibilidad, type HoursInitial } from "./disponibilidad";
import { freeTime, userId } from "@/lib/visit";

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function clockIn(iso: string, zoneName: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { fecha: `${get("year")}-${get("month")}-${get("day")}`, hora: `${hour}:${get("minute")}` };
}

async function hoursOf(id: string): Promise<HoursInitial> {
  const parsed = userId(id);
  const rules = await freeTime(parsed);
  const zones = new Set(rules.map((rule) => rule.zone));
  const zoneName = zones.size === 1 ? [...zones][0] : "Europe/Madrid";
  const days = Array.from({ length: 7 }, () => ({ inicio: "", fin: "" }));
  const spans: HoursInitial["spans"] = [];
  for (const rule of rules) {
    if (rule.kind === "weekly") {
      const slot = days[rule.weekday - 1];
      if (!slot.inicio) {
        slot.inicio = hhmm(rule.startMin);
        slot.fin = hhmm(rule.endMin);
      }
      continue;
    }
    const start = clockIn(rule.start, zoneName);
    const end = clockIn(rule.end, zoneName);
    spans.push({ fecha: start.fecha, inicio: start.hora, fin: end.hora });
  }
  spans.push({ fecha: "", inicio: "", fin: "" });
  return { zoneName, days, spans };
}

/**
 * Everything about you rather than about a home: what the family sees you called, and how a home
 * gets in. They are one page because they are one thing — the account — and because there was
 * never enough of either to be a page on its own.
 *
 * It used to lead with dragging a bookmarklet to a desktop toolbar. Since issue #111 that is the
 * exception: a pasted link is opened by a real browser on the server, and every portal below is
 * on the paste allowlist. So «Añadir enlace» reads first and the marker reads second, as the
 * thing you reach for when neither of those works (F37, PIP-14).
 */
export default async function AjustesPage() {
  const { capture_token, name, email, id } = await currentUser();
  const hours = await hoursOf(id);
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:3000";
  const bookmarklet = buildBookmarklet(publicUrl, capture_token);
  const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const uptimeMin = Math.floor(process.uptime() / 60);

  // React 19 rewrites any `javascript:` href to a throw, so the anchor is emitted as raw HTML.
  // Safe: buildBookmarklet percent-encodes the code, so no quote or angle bracket reaches the attribute.
  const link =
    `<a href="${bookmarklet}" class="btn-primary inline-flex h-12 items-center gap-2 rounded-lg px-5 font-medium select-none">` +
    "📌 Guardar en CasaEnComú</a>";

  const h2 = "text-lg font-medium";
  return (
    <div className="mx-auto max-w-2xl divide-y divide-hairline-soft px-4 py-6 sm:px-6">
      <h1 className="pb-6 text-[22px] font-medium">Ajustes</h1>

      <section className="space-y-3 py-8">
        <h2 className={h2}>Tu nombre</h2>
        <p className="text-body">
          Es como te ve el resto en las opiniones y en la actividad. Solo en este proyecto: en otro
          puedes llamarte de otra manera.
        </p>
        <form action={renombrarseAction} className="flex gap-2">
          <input
            type="text"
            name="nombre"
            required
            maxLength={PERSON_NAME_MAX}
            defaultValue={name}
            aria-label="Tu nombre"
            className={input}
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-lg bg-ink px-5 text-base font-medium text-canvas transition hover:opacity-90"
          >
            Guardar
          </button>
        </form>
        <p className="text-sm text-muted">Entras como {email}.</p>
      </section>

      <section className="space-y-3 py-8">
        <h2 className={h2}>Cuándo puedes visitar</h2>
        <p className="text-body">
          Las horas en las que puedes ver un piso. El grupo las usa para elegir una visita. Una franja
          vacía no se guarda.
        </p>
        <Disponibilidad initial={hours} />
      </section>

      <section className="space-y-3 py-8">
        <h2 className={h2}>Tu clave</h2>
        <p className="text-body">
          Al cambiarla se cierran todas tus sesiones, también esta. Entras otra vez con la nueva.
          Si tenías un código de recuperación, deja de servir: crea otro después de entrar.
        </p>
        <ClaveForm />
      </section>

      <section className="space-y-3 py-8">
        <h2 className={h2}>Recuperación de cuenta</h2>
        <RecoveryCodeForm />
      </section>

      <section className="space-y-3 py-8">
        <h2 id="anadir-piso" className={`${h2} scroll-mt-24`}>Cómo añadir un piso</h2>
        <p className="text-body">
          Copia el enlace del anuncio y pégalo en{" "}
          <Link href="/propiedades" className="font-medium text-ink underline underline-offset-4">
            Propiedades
          </Link>{" "}
          → «Añadir enlace». Eso es todo, también desde el móvil.
        </p>
        <p className="text-body">
          El enlace queda guardado aunque el portal no permita leerlo. Verás «Sin leer» hasta que
          tengamos sus datos. Puedes completarlos abriendo el anuncio y usando el marcador de abajo.
          La campana te avisa cuando se complete.
        </p>
        {/* The list is built from the allowlist itself, so it cannot promise a portal the app
            would refuse, or forget one it accepts. */}
        <ul className="divide-y divide-hairline-soft border-y border-hairline-soft">
          {PORTALS.map((p) => (
            <li key={p.host} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="flex-1 font-medium text-ink">{p.name}</span>
              <span className="text-muted">
                {p.route === "server" ? "Lectura directa cuando está disponible" : "Requiere lectura en el navegador"}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          De otro portal no podemos leer el enlace. Ábrelo en el navegador y usa el marcador de abajo.
        </p>
      </section>

      <section className="space-y-3 py-8">
        <h2 className={h2}>El marcador, para lo demás</h2>
        <p className="text-body">
          Guarda la página que tengas abierta, sea del portal que sea. Es lo que hay que usar con un
          portal que no está en la lista, y también si un anuncio lleva mucho «Sin leer».
        </p>
        <p className="text-body">Arrástralo a la barra de marcadores (no hagas clic aquí):</p>
        <p dangerouslySetInnerHTML={{ __html: link }} />
        <p className="text-sm text-muted">
          Después, abre un anuncio y pulsa el marcador. Se abre una pestaña con el piso guardado.
        </p>

        <h3 className="pt-3 text-[15px] font-medium text-ink">En el iPhone (Safari)</h3>
        <p className="text-sm text-muted">
          No hay nada que instalar desde la App Store: es un marcador normal al que se le cambia la
          dirección.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-body">
          <li>Guarda cualquier página en Favoritos: botón Compartir → «Añadir marcador».</li>
          <li>Abre Marcadores → «Editar» y toca ese marcador.</li>
          <li>Cámbiale el nombre a «Guardar en CasaEnComú» y sustituye la dirección por el código de abajo.</li>
          <li>Abre un anuncio, toca la barra de direcciones y elige el marcador.</li>
        </ol>
        <p className="text-sm text-muted">
          Copiar el código no es instalarlo: hay que pegarlo en el marcador del paso 3.
        </p>
        <CopyBox value={bookmarklet} label="Código del marcador" />
      </section>

      <section className="py-8">
        {/* ponytail: a native <details>. Uptime and a clock are for whoever is debugging the
            server, and they were sitting under a heading of their own. */}
        <details className="group">
          <summary className="touch-target inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-body transition hover:text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition group-open:rotate-90" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
            Detalles técnicos
          </summary>
          <p className="mt-3 text-sm text-muted">
            Servidor en marcha desde hace {uptimeMin} min · {now}
          </p>
        </details>
      </section>
    </div>
  );
}
