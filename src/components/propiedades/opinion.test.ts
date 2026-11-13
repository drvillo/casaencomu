import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source guards for issues #127, #128 and #129 — the four bands of the detail page. Every defect
 * here is structural: a second composer still posts comments, a save that writes half an opinion
 * still writes, and a form whose columns drifted still renders. None of it shows in a type check.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const page = read("../../app/propiedades/[id]/page.tsx");
const form = read("./opinion-form.tsx");
const actions = read("../../app/propiedades/actions.ts");
const editor = read("./opinion-editor.tsx");
const panel = read("../panel.tsx");
const cards = read("./opinion-cards.tsx");
const chat = read("./conversation.tsx");

const at = (marker: string) => {
  const i = page.indexOf(marker);
  expect(i, `no marker: ${marker}`).toBeGreaterThan(-1);
  return i;
};

describe("the page reads as four bands and then its record", () => {
  it("in that order: the home, your opinion, the family, the map, the record", () => {
    const order = ["{/* ---- band 1", "{/* ---- band 2", "{/* ---- band 3", "{/* ---- band 4", "{/* ---- the record"].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the description takes the width and the facts stand beside it, narrow", () => {
    expect(page).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
    expect(at("<h2 className={h2}>Descripción</h2>")).toBeLessThan(at('<h2 className="mb-2 text-sm font-semibold text-ink">Datos</h2>'));
    // A deduced value still says so: layer 3 is not a fact the advertisement states.
    expect(page).toContain("deduced(key) &&");
  });

  it("the price is with the title, not in a card halfway down the page", () => {
    expect(at("<h1")).toBeLessThan(at('{fmtEur(p.price_eur, "Sin precio")}'));
    expect(at('{fmtEur(p.price_eur, "Sin precio")}')).toBeLessThan(at("{/* ---- band 1"));
    // The sticky side card it came from is gone, with the two forms that were under it.
    expect(page).not.toContain("lg:sticky");
    expect(page).not.toContain("<aside className=\"lg:col-start-2 lg:row-start-1 lg:self-start");
  });

  it("the advertisement's own record reads after the map, not inside the reading column", () => {
    expect(at('<h2 className={hRecord}>El anuncio</h2>')).toBeGreaterThan(at("{/* ---- band 4"));
    for (const heading of ["Historial de precio", "Actividad"]) {
      expect(at(`<h3 className={hRecord}>${heading}</h3>`)).toBeGreaterThan(at("{/* ---- band 4"));
    }
  });

  /**
   * F36. «Fuentes», «Historial de precio» and «Actividad» carried the same `h2` as «Descripción»
   * and «Tu opinión», so the record of the advertisement competed with the family's conversation
   * about it.
   */
  it("gives the record a smaller voice than the conversation", () => {
    expect(page).toContain("const hRecord =");
    // Every `h2` left on the page belongs to a band a person reads, never to the record.
    const h2s = [...page.matchAll(/<h2 className=\{h2\}>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(h2s).not.toContain("Fuentes");
    expect(h2s).not.toContain("Historial de precio");
    expect(h2s).not.toContain("Actividad");
    // And the history is behind a fold the browser opens by itself.
    expect(page).toContain("<details className=\"group mt-6\">");
    expect(page).toContain("Historial de precio y actividad");
  });

  /**
   * F35. The panel printed twelve rows whatever was known, and on a real listing seven of them
   * read «Sin datos». Measured across the family's 23 homes: all 23 lack the energy certificate.
   */
  it("shows the facts it has, and names the rest once", () => {
    expect(page).toContain("const known = facts.filter(([, v]) => v !== null)");
    expect(page).toContain("const missing = facts.filter(([, v]) => v === null)");
    expect(page).toContain("{known.map(([k, val, key])");
    expect(page).toContain("No consta:");
    // The one place that could answer, offered beside the question.
    expect(page).toContain("Míralo en");
    // A home nobody has read yet is a different sentence: nothing is missing, nothing is there.
    expect(page).toContain("Todavía no se ha leído el anuncio.");
    // «Sin datos» must not come back through the formatter that used to produce it.
    expect(page).not.toContain("siNo(");
  });

  /** F36. «UNA REFORMA INTEGRAL EN PLENA DIAGON…» is where a one-line title ended. */
  it("lets a gallery card use two lines for its title, and keeps the prices in a row aligned", () => {
    const card = readFileSync(fileURLToPath(new URL("./card.tsx", import.meta.url)), "utf8");
    const title = card.slice(card.indexOf("<h2"), card.indexOf("</h2>"));
    expect(title).toContain("line-clamp-2");
    expect(title).not.toContain("truncate");
    // Both lines are always reserved, so a short title does not lift its price above its neighbour's.
    expect(title).toContain("min-h-[2.75em]");
  });

  it("gives every band an anchor an activity line can land on", () => {
    for (const anchor of ["descripcion", "opinion", "opiniones", "conversacion", "anuncio"]) {
      expect(page, anchor).toContain(`id="${anchor}"`);
    }
    // An anchor under a sticky header lands behind it unless the offset is stated.
    expect(page.match(/scroll-mt-\[calc\(var\(--header-h\)\+16px\)\]/g) ?? []).toHaveLength(5);
  });
});

describe("one box, one button", () => {
  it("is one form with one submit", () => {
    expect(form.match(/<form\b/g) ?? []).toHaveLength(1);
    expect(form.match(/type="submit"/g) ?? []).toHaveLength(1);
    // The page has no second composer: the only way into the conversation is this box.
    expect(page).not.toContain("<textarea");
    expect(page).not.toContain("CommentForm");
  });

  it("is two halves now the comment box has gone down to the conversation (#146)", () => {
    expect(form).toContain("lg:grid-cols-2");
    expect(form).not.toContain('name="body"');
  });

  it("carries your opinion and then the state", () => {
    const q = form.indexOf("<OpinionEditor ");
    const s = form.indexOf('name="etapa"');
    expect(q).toBeGreaterThan(-1);
    expect(q).toBeLessThan(s);
  });

  it("puts the button at the foot of the state column", () => {
    const tail = form.slice(form.indexOf('name="etapa"'));
    expect(tail).toContain('<div className="mt-auto space-y-2 pt-2">');
    expect(tail.indexOf('className="mt-auto')).toBeLessThan(tail.indexOf('type="submit"'));
  });

  it("keeps a 44 px target on every choice and on the button", () => {
    expect(editor).toContain("h-11 w-full"); // the five scores
    expect(editor).toContain("h-12 w-full"); // the stance choices and the publish button
    expect(form).toContain("h-12 w-full"); // the stage control and the save button
  });

  it("writes no colour of its own", () => {
    for (const src of [form, editor, panel]) {
      // «(#141)» is an issue, not a colour.
      expect(src.replace(/\(#\d+\)/g, "").match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
      expect(src.match(/\brgba?\(/g) ?? []).toEqual([]);
    }
  });
});

describe("the opinion editor (#141)", () => {
  it("asks in the order the contract sets", () => {
    const order = ["¿Cómo lo ves?", "Por qué lo ves así", "Hay un impedimento importante para mí", "Valorar por aspectos", "¿En qué te basas?"].map(
      (t) => {
        const i = editor.indexOf(t);
        expect(i, `missing: ${t}`).toBeGreaterThan(-1);
        return i;
      },
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("counts the aspects answered, and does not preselect one", () => {
    expect(editor).toContain('const rated = DIMENSIONS.filter((d) => typeof input.scores[d] === "number").length;');
    expect(editor).toContain("{rated} de {DIMENSIONS.length} aspectos valorados");
    expect(editor).not.toContain("defaultChecked");
  });

  it("offers «No lo sé», which is how a published score is removed", () => {
    expect(editor).toContain("No lo sé");
    expect(editor).toContain("setScore(dim, null)");
  });

  it("saves a draft only when asked: no timer, no blur, no autosave", () => {
    expect(editor).not.toContain("setTimeout");
    expect(editor).not.toContain("onBlur");
    expect(editor).toContain("Guardar borrador");
  });

  it("keeps every word on a refusal, and names the two kinds", () => {
    expect(editor).toContain('result.reason === "conflict"');
    // The refusal path touches no field: `setInput` appears nowhere inside it.
    const refusal = editor.slice(editor.indexOf("if (!result.ok)"), editor.indexOf("setSaved(input);"));
    expect(refusal).not.toContain("setInput");
  });

  it("asks before withdrawing, in the contract's words", () => {
    expect(editor).toContain("Dejará de mostrarse a la familia. Puedes volver a publicarla más adelante.");
    // The call lives inside the branch the question opens, so it cannot be reached in one click.
    expect(editor.indexOf("{confirming ? (")).toBeLessThan(editor.indexOf("withdrawOpinionAction(propertyId"));
  });

  it("offers the three ways out of an unsaved editor", () => {
    for (const t of ["Seguir editando", "Guardar borrador", "Descartar los cambios"]) expect(editor).toContain(t);
    // Never a browser dialog: it cannot be read, styled or undone.
    expect(editor).not.toContain("window.confirm");
    expect(panel).not.toContain("confirm(");
  });

  it("is one native dialog, and lets the browser do what a dialog already does", () => {
    expect(panel).toContain("showModal()");
    expect(panel).toContain("onCancel");
    expect(panel).not.toContain("addEventListener(\"keydown\"");
  });
});

describe("the save is one write, and writes only what changed", () => {
  it("the three old actions and their three forms are gone", () => {
    for (const fn of ["rateAction", "commentAction", "setStageAction"]) expect(actions).not.toContain(fn);
    for (const f of ["./rating-form.tsx", "./comment-form.tsx", "./stage-form.tsx"]) expect(() => read(f)).toThrow();
  });

  it("everything lands in one transaction", () => {
    const body = actions.slice(actions.indexOf("export async function stageAction"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toContain('db.transaction("write")');
    expect(fn).toContain("commitStage(");
    expect(fn).not.toContain("db.batch(");
  });

  it("no longer writes a score at all: that only happens through a publication", () => {
    expect(actions).not.toContain("UPSERT_RATING_SQL");
    expect(actions).not.toContain('event(propertyId, "rating"');
    const body = actions.slice(actions.indexOf("export async function stageAction"));
    expect(body).not.toContain("INSERT INTO ratings");
  });

  it("names the author from the session, never from the request", () => {
    for (const fn of ["publishOpinionAction", "saveDraftAction", "withdrawOpinionAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf("}"))).toContain("await currentUser()");
    }
    expect(actions).not.toContain("formData.get(\"userId\")");
  });

  it("the stage it is already in is refused, not silently accepted", () => {
    expect(actions).toContain('if (from === to) return { ok: false, message: "Ya está en esa etapa." };');
  });

  it("the receipt names the stage it moved to", () => {
    expect(actions).toContain("return { ok: true, saved: STAGE_LABELS[to as Stage] };");
    expect(form).toContain("Guardado: {state.saved}.");
  });
});

describe("what the family thinks, in words before numbers (#144)", () => {
  it("puts the person cards above the grid of numbers", () => {
    const band = page.slice(at("{/* ---- band 3"), at("{/* ---- band 4"));
    expect(band.indexOf("<OpinionCards")).toBeGreaterThan(-1);
    expect(band.indexOf("<OpinionCards")).toBeLessThan(band.indexOf("<table"));
    expect(band.indexOf("<Disagreements")).toBeLessThan(band.indexOf("<table"));
  });

  it("reads only opinions that were published and not withdrawn", () => {
    expect(page).toContain("WHERE o.property_id = ? AND o.withdrawn = 0");
    // Never a draft: `opinion_drafts` is not in this page's batch at all.
    expect(page).not.toContain("opinion_drafts");
  });

  it("does not present the known accounts as the whole family", () => {
    const cards = read("./opinion-cards.tsx");
    expect(cards).toContain("Personas registradas sin opinión");
    expect(cards).toContain("no la familia entera");
    // Nothing sorts people by how positive they were.
    expect(cards).toContain('a.name.localeCompare(b.name, "es")');
  });

  it("never folds away an impediment", () => {
    const cards = read("./opinion-cards.tsx");
    expect(cards).toContain("const fold = o.reasoning.length > LONG && !o.blocker;");
  });
});

describe("what the family thinks", () => {
  it("the table has a column and a row of averages, and a corner", () => {
    const table = page.slice(at("{/* ---- band 3"), at("{/* ---- band 4"));
    // One aspect and one person use their own helpers: each is already one score per person,
    // while the corner has to average people rather than rows (#130).
    expect(table).toContain("dimensionAverage(dimRows)");
    expect(table).toContain("memberAverage(ratingRows, u.id)");
    expect(table).toContain("{fmtScore(family)}");
    expect(table).toContain("Parcial");
    // A person who did not score reads as a dash. Zero is a score; missing is not.
    expect(table).toContain('{m[u.id][dim] ?? "—"}');
  });

  it("the conversation is a component of its own, in band 3", () => {
    const chat = page.slice(at("{/* ---- band 3"), at("{/* ---- band 4"));
    expect(chat).toContain("<Conversation");
    // The page renders none of it itself any more: replies need state, and state needs a client.
    expect(chat).not.toContain("flex-col-reverse");
  });
});

/**
 * Answering one person, and the table staying readable on a telephone (2026-09-29).
 *
 * The opinion and the conversation were built as two separate things, and nothing joined them:
 * you read what somebody thought, and then you scrolled past a table to a box and looked for
 * their name in a chooser. Document 04 § 5 asks for «Responder» on the card itself.
 */
describe("answering the person whose opinion you just read", () => {
  it("offers a way to answer every author but yourself", () => {
    expect(cards).toContain("Responder a {o.name}");
    // Answering your own opinion is a comment, not a reply: the card offers nothing.
    expect(cards).toContain("{o.user_id !== readerId && (");
  });

  it("carries the person, and lands on the conversation", () => {
    expect(page).toContain('q.set("responder", userId)');
    expect(page).toContain("#conversacion");
    // The list the reader came from survives the trip, so the back link still works.
    expect(page).toContain('if (desde) q.set("desde", desde)');
  });

  it("opens the composer with that person already chosen", () => {
    expect(chat).toContain('defaultValue={about ?? ""}');
    expect(chat).toContain("Respondiendo a la opinión de");
    // A mounted <select> keeps its own value, so the person in the URL needs a new one.
    expect(chat).toContain('key={about ?? ""}');
  });

  it("ends the disagreement paragraph with the person to ask", () => {
    // «Ana puntúa 1, tú puntúas 5.» used to be the last word on the subject.
    expect(cards).toContain("Preguntar a {name(ask)}");
    expect(cards).toContain("const other = (g:");
  });
});

describe("the aspect table is who scored, not who has an account", () => {
  it("draws a column only for a person who scored something", () => {
    // Ten accounts are allowed and seven exist. A column of six dashes each makes the grid
    // unreadable at 390 px, and the page is read on telephones.
    expect(page).toContain("const scoringMembers = memberRows.filter((u) => ratingRows.some((r) => r.user_id === u.id))");
    const table = page.slice(at("{/* ---- band 3"), at("{/* ---- band 4"));
    expect(table).not.toContain("memberRows.map");
    expect(table).toContain("scoringMembers.map");
  });

  it("says so, and draws nothing at all when nobody has scored", () => {
    expect(page).toContain("Solo las personas que han puntuado");
    expect(page).toContain("{ratingRows.length === 0 ? (");
    expect(page).toContain("Nadie ha puntuado los aspectos todavía");
  });
});

describe("the editor does not lose what somebody typed", () => {
  it("keeps it in this tab, as the comment box already did", () => {
    expect(editor).toContain("writeDraft(owner, key,");
    expect(editor).toContain('draftKey(owner, "opinion", propertyId)');
    // Read on opening, so the words come back after a reload or a telephone dropping the tab.
    expect(editor).toContain("keep.read(mine) ?? initial(mine)");
    expect(editor).toContain("Cambios sin guardar · solo en esta pestaña");
  });

  it("ignores a copy that a newer save has overtaken", () => {
    // A draft saved on another device moves the revision. The tab's older copy must not win.
    expect(editor).toContain("held?.version === mine.version && held?.revision === mine.revision ? held.input : null;");
  });

  it("forgets it once the words are on the server", () => {
    expect(editor).toContain("keep.clear();");
    // The server has no sessionStorage: reading it during render would break hydration.
    expect(editor).toContain("useSyncExternalStore");
  });
});
