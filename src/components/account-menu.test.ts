import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/**
 * The top bar ran out of room: six controls, and two of them spent on things nobody wanted there
 * — a `?` and an icon of several people that looked like a members list (#148).
 */
describe("the right-hand end of the top bar", () => {
  const nav = read("./nav.tsx");

  it("has no help control at all", () => {
    expect(nav).not.toContain("/ayuda");
    expect(nav).not.toContain('aria-label="Ayuda"');
  });

  it("no longer links straight to the projects page", () => {
    expect(nav).not.toContain('href="/proyectos"');
  });

  it("is the bell, the theme, and you", () => {
    expect(nav).toContain("<NotificationsMenu");
    expect(nav).toContain("<ThemeToggle />");
    expect(nav).toContain("<AccountMenu name={user.name} email={user.email} />");
  });

  it("drops the greeting, which the menu now says in full", () => {
    expect(nav).not.toContain("Hola {user.name}");
  });
});

describe("the account menu", () => {
  const menu = read("./account-menu.tsx");

  it("goes to ajustes, visitas, proyectos, and the way out", () => {
    expect(menu).toContain('href: "/ajustes", label: "Ajustes"');
    expect(menu).toContain('href: "/visitas", label: "Visitas"');
    expect(menu).toContain('href: "/proyectos", label: "Proyectos"');
    expect(menu).toContain('href="/salir"');
    expect(menu).toContain("Cerrar sesión");
  });

  // A `<Link>` would prefetch it, and prefetching the way out signs you out on hover.
  it("leaves by a plain anchor, never a router link", () => {
    expect(menu).toMatch(/<a role="menuitem" href="\/salir"/);
  });

  it("closes on Escape and on a press outside it, like the bell", () => {
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain('document.addEventListener("pointerdown", away)');
  });
});

describe("signing out", () => {
  it("hands a Cloudflare deployment to Cloudflare, which owns the session", () => {
    const route = read("../app/salir/route.ts");
    expect(route).toContain("process.env.CF_ACCESS_TEAM_DOMAIN");
    expect(route).toContain("/cdn-cgi/access/logout");
  });

  // Read rather than run, since signing out now deletes a session row and needs a request scope.
  it("makes the preview forget the password it has been repeating", () => {
    const route = read("../app/salir/route.ts");
    expect(route).toContain("PREVIEW_PASSWORD");
    expect(route).toContain("status: 401");
    expect(route).toContain("www-authenticate");
  });

  it("sends everybody else to the login page", () => {
    const route = read("../app/salir/route.ts");
    expect(route).toContain('redirect("/entrar")');
  });

  it("ends our own session first, whatever door is in front", () => {
    // The row goes, not only the cookie: a cookie left in a browser must name nothing.
    const route = read("../app/salir/route.ts");
    expect(route).toContain("endSession");
    expect(route).toContain("jar.delete(SESSION_COOKIE)");
  });
});
