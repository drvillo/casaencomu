import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Source guards for the states that are hard to reach and easy to lose in a refactor. */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const add = read("./propiedades/search-bar.tsx");
// The comment, the scores and the stage are one form since #128; the three that were here are gone.
const opinion = read("./propiedades/opinion-form.tsx");
const actions = read("../app/propiedades/actions.ts");
const css = read("../app/globals.css");

describe("adding a link keeps what was typed (F16)", () => {
  it("holds the URL in state, so a failure cannot clear the field", () => {
    expect(add).toContain("value={url}");
    expect(add).toContain("setUrl(e.target.value)");
    // Only a success empties it.
    expect(add.match(/setUrl\(""\)/g) ?? []).toHaveLength(1);
  });

  it("refuses a second submission without disabling the field", () => {
    expect(add).toContain("if (busy) return;");
    expect(add).toContain("aria-busy={busy}");
    // Nothing is truly disabled: a disabled control loses focus, and the page must stay readable.
    expect(add.match(/(?<!aria-)disabled/g) ?? []).toHaveLength(0);
  });

  it("names one honest pending state and no invented progress", () => {
    expect(add).toContain("Guardando propiedad…");
    expect(add).toContain("SLOW_MS");
    // No invented progress. Read the status block only: the pill's own width is a percentage.
    const status = add.slice(add.indexOf('id="add-status"'));
    expect(status).not.toMatch(/\d+%/);
  });

  it("still works before it has hydrated, instead of navigating to a query string", () => {
    expect(add).toContain('method="post"');
    expect(add).toContain('action="/api/import"');
  });

  it("classifies the link before sending it", () => {
    const classify = add.indexOf("routeFor(value)");
    const send = add.indexOf('fetch("/api/import"');
    expect(classify).toBeGreaterThan(-1);
    expect(classify).toBeLessThan(send);
  });
});

/**
 * The dialog of PIP-08 is gone; the control Kenobi asked for is back (2026-09-08). It grows the
 * link field leftwards out of a button that never moves, and the message it needs for the states
 * above sits under the pill rather than inside it.
 */
describe("the add control grows out of its own button", () => {
  it("animates its width and yields the search field on a phone", () => {
    expect(add).toContain("${motion}"); // the width and the icon share one curve, declared once
    expect(add).toContain("hidden sm:flex");
    expect(add).toContain('transitionProperty: "width, background-color, border-color, box-shadow"');
  });

  it("puts the message below the pill, where it cannot change the field's height", () => {
    expect(add).toContain('className="add-status"');
    expect(css).toContain(".add-status {");
    expect(css).toContain("position: absolute");
  });

  it("turns the + into an ×, the long way round, and drops the second close button", () => {
    expect(add).toContain("rotate(${open ? 225 : 0}deg)"); // half a turn, then the 45° that makes the ×
    expect(add).toContain("`transition-transform ${motion}`"); // the same curve the field grows on
    expect(add).toContain('aria-label={open ? "Cerrar" : "Añadir un anuncio"}');
    // One × on the pill. Two buttons that both close is what this replaced.
    expect(add.match(/aria-label="Cerrar"/g) ?? []).toHaveLength(0);
    expect(add).toContain('<button type="submit" className="sr-only"'); // …so Enter still saves
  });

  it("puts the focus ring around the pill, not around the field inside it", () => {
    expect(add).toMatch(/const pill =\s*"pill /); // the class the ring hangs off, however it wraps
    expect(css).toContain(".pill:has(input:focus-visible)");
    expect(css.slice(css.indexOf(".pill:has("))).toMatch(/^[^}]*outline: 2px solid/); // still a ring, just on the pill
    expect(css).toContain(".pill input:focus-visible");
    expect(css).toContain(":focus-visible {"); // the global ring (F32) is still there for everything else
  });

  /*
   * The pill answers a submitted link with colour. What makes that honest rather than decorative
   * is that the verdict is never on a timer: `sent` waits, and `ok`/`bad` are set where the
   * answer actually arrives. A fixed clock would be inventing one — the server has 25 seconds.
   */
  it("shows the verdict when there is one, never on a clock", () => {
    expect(add).toContain('setFlash("sent")');
    // The one place `ok` is set is where the server said yes.
    const ok = add.slice(add.indexOf("if (res.ok && data?.location)"));
    expect(ok).toContain('setFlash("ok")');
    expect(add.match(/setFlash\("ok"\)/g) ?? []).toHaveLength(1);
    // `sent` never becomes a verdict by itself: nothing schedules ok/bad off a timer except the
    // three answers this browser already has.
    expect(add).toContain('const answer = (kind: "ok" | "bad") => setTimeout(() => setFlash(kind), SENT_MS)');
    expect(css).toContain('.pill[data-flash="sent"]::after');
    expect(css).toContain("@keyframes pill-verdict");
  });

  it("does not let the browser draw its own bubble over the pill", () => {
    // `required` is what puts "Please fill out this field" on top of the control. The empty case
    // is answered by the pill, and by `/api/import`, which refuses a missing url with a 400.
    expect(add).not.toMatch(/^\s*required$/m);
    expect(add).toContain('aria-required="true"');
    expect(add).toContain('message: "Pega el enlace del anuncio."');
  });

  it("no longer ships a dialog for it", () => {
    expect(add).not.toContain("Dialog");
    expect(() => read("./ui/dialog.tsx")).toThrow();
  });
});

describe("a refused save keeps the words (F25)", () => {
  it("the comment comes back with its text, and the opinion keeps every field", () => {
    expect(actions).toContain("text: string");
    expect(actions).toContain("const back = { text: raw };");
    // The comment box moved to the conversation in #146; the guarantee moved with it.
    const talk = read("./propiedades/conversation.tsx");
    expect(talk).toContain("defaultValue={failed?.text ?? \"\"}");
    // The editor holds every answer in React and a refusal never writes to that state, so a
    // refused publication costs nothing the person typed or chose (#141).
    const editor = read("./propiedades/opinion-editor.tsx");
    expect(editor).toContain("checked={input.scores[dim] === n}");
    expect(editor.slice(editor.indexOf("if (!result.ok)"), editor.indexOf("setSaved(input);"))).not.toContain("setInput");
  });

  it("a stage change is conditional on the version it was drawn from", () => {
    const stage = read("../lib/stage.ts");
    expect(stage).toContain("WHERE id = ? AND stage_version = ?");
    expect(actions).toContain("Number(prop.rows[0].stage_version) !== seen");
    expect(opinion).toContain('name="version"');
  });

  it("no save action ever returns nothing at all", () => {
    for (const fn of ["stageAction", "conversationAction"]) {
      const at = actions.indexOf(`export async function ${fn}`);
      const body = actions.slice(at, actions.indexOf("\n}\n", at));
      expect(body, `${fn} still has a bare return`).not.toMatch(/^\s*(if \(.*\) )?return;\s*$/m);
    }
  });
});
