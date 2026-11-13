"use client";

import { syncDraftAccount } from "@/lib/draft-storage";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/ajustes", label: "Ajustes", icon: "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" },
  { href: "/visitas", label: "Visitas", icon: "M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" },
  { href: "/proyectos", label: "Proyectos", icon: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
] as const;

const ROW = "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition hover:bg-surface-soft";

/**
 * You, in the top bar. Your settings, the visits, your projects, and the way out.
 *
 * It replaces the two controls that used to sit here: an icon of several people, which looked
 * like a list of members rather than a way to your own account, and a `?` that spent a whole slot
 * on a page read once. The help is inside «Ajustes» now, under your own name (#148).
 *
 * Signing out is a plain link, never a form: `/salir` decides what signing out means here, and
 * the browser has to follow it to Cloudflare rather than fetch it.
 */
export default function AccountMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Same as the bell: a menu that only closes with its own button is a trap on a phone.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Tu cuenta"
        title="Tu cuenta"
        className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-control-border text-ink transition hover:shadow-tier"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Tu cuenta"
          className="absolute right-0 top-[calc(100%+10px)] z-30 w-[min(17rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-raised p-1.5 shadow-tier"
          onClick={() => setOpen(false)}
        >
          <span
            aria-hidden
            className="absolute -top-[7px] right-4 h-3 w-3 rotate-45 border-l border-t border-hairline bg-raised"
          />
          <div className="border-b border-hairline-soft px-3 pb-3 pt-2">
            <p className="truncate font-medium text-ink">{name}</p>
            <p className="truncate text-sm text-muted">{email}</p>
          </div>

          {ITEMS.map(({ href, label, icon }) => (
            <Link key={href} role="menuitem" href={href} className={`${ROW} mt-1 text-ink`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={icon} />
              </svg>
              {label}
            </Link>
          ))}

          <a role="menuitem" href="/salir" onClick={() => syncDraftAccount(null)} className={`${ROW} mt-1 border-t border-hairline-soft pt-3 text-body`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Cerrar sesión
          </a>
        </div>
      ) : null}
    </div>
  );
}
