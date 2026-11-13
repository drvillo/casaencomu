import { createRemoteJWKSet } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionEmail } from "@/lib/accounts";
import { previewEmail, verifyAccessToken } from "@/lib/auth";

// ponytail: jose over hand-rolled RS256 — security path, keep the dep
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** The two pages a person must reach before they have a session, or they can never get one. */
const OPEN = (path: string) => path === "/entrar" || path === "/recuperar" || path.startsWith("/invitacion/");

export async function proxy(request: NextRequest) {
  // Always overwritten: an incoming x-user-email is never trusted.
  const forward = (email: string) => {
    const headers = new Headers(request.headers);
    headers.set("x-user-email", email);
    return NextResponse.next({ request: { headers } });
  };

  const path = request.nextUrl.pathname;

  // Dev bypass: only in `next dev` and only when AUTH_DEV_EMAIL is set.
  // `process.env.NODE_ENV` is inlined at build time, so this branch is dead code in production.
  if (process.env.NODE_ENV === "development" && process.env.AUTH_DEV_EMAIL) {
    return forward(process.env.AUTH_DEV_EMAIL);
  }

  // The app's own door. Next 16 runs this file on Node, so the session is read from the database
  // here: the cookie carries nothing, and deleting the row ends the session on the next request.
  const mine = await sessionEmail(request.cookies.get(SESSION_COOKIE)?.value);
  if (mine) return forward(mine);

  const team = process.env.CF_ACCESS_TEAM_DOMAIN;
  const audience = process.env.CF_ACCESS_AUD;

  // No session, and nothing else configured to say who this is: send them to the login page and
  // remember where they wanted to go. An API call has nowhere to be sent, so it is refused.
  if (!team && !process.env.PREVIEW_OPEN_AS && !process.env.PREVIEW_PASSWORD) {
    if (OPEN(path)) return forward("");
    if (path.startsWith("/api/")) return unauthorized();
    const to = new URL("/entrar", request.url);
    if (path !== "/") to.searchParams.set("a", path + request.nextUrl.search);
    return NextResponse.redirect(to);
  }

  // Preview mode: a shared password, for the Air behind Tailscale while the Access
  // deploy waits on its owner-only items. Cloudflare wins when it is configured, so
  // a stray PREVIEW_PASSWORD can never downgrade a real deployment.
  if (!team || !audience) {
    // No prompt at all: everyone who reaches the app is this one identity. It is safe only
    // because the preview is reachable over the tailnet and nowhere else — the tailnet is the
    // perimeter, not the password. Never set this on a host the internet can reach.
    const openAs = process.env.PREVIEW_OPEN_AS;
    if (openAs) return forward(openAs);

    const password = process.env.PREVIEW_PASSWORD;
    if (!password) {
      return NextResponse.json(
        { error: "auth misconfigured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or PREVIEW_PASSWORD" },
        { status: 500 },
      );
    }
    const email = await previewEmail(request.headers.get("authorization"), password);
    return email
      ? forward(email)
      : new NextResponse("Escribe tu nombre y la clave de acceso.", {
          status: 401,
          headers: { "www-authenticate": 'Basic realm="CasaEnComu", charset="UTF-8"' },
        });
  }

  const token =
    request.headers.get("cf-access-jwt-assertion") ?? request.cookies.get("CF_Authorization")?.value;
  if (!token) return unauthorized();

  try {
    jwks ??= createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    const email = await verifyAccessToken(token, { jwks, issuer: `https://${team}`, audience });
    return forward(email);
  } catch {
    return unauthorized();
  }
}

export const config = {
  // Exempt: the health probe, Next's own assets, the favicon, the capture endpoints, and the
  // visit inbound webhook. A capture arrives from a portal's own page, or from the browser reader
  // on the host, and carries no session of ours; the per-member `capture_token` is its guard.
  // The webhook carries `MAIL_INBOUND_SECRET` instead, and it must not read a session.
  matcher: ["/((?!api/health|api/capture|api/visitas/entrada|_next/|favicon.ico).*)"],
};
