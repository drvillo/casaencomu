import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISIT_STATUSES } from "@/lib/visit-plan";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the visit screens", () => {
  it("links a home to its contact and does not review it from there", () => {
    const property = read("../propiedades/[id]/page.tsx");
    expect(property).toContain("Contacto con el anunciante");
    expect(property).toContain("markReviewed");
    expect(read("./page.tsx")).not.toContain("markReviewed");
    expect(read("./[id]/page.tsx")).not.toContain("markReviewed");
    expect(read("../ajustes/page.tsx")).toContain("Cuándo puedes visitar");
  });

  it("puts Visitas in the account menu and keeps the four header tabs", () => {
    expect(read("../../components/account-menu.tsx")).toContain('href: "/visitas", label: "Visitas"');
    expect(read("../../components/nav.tsx")).not.toContain("/visitas");
    expect(read("../../components/nav-links.tsx")).not.toContain("Visitas");
  });

  it("names both visit events and every visit status on a chip", () => {
    const listing = read("../../lib/listing.ts");
    expect(listing).toContain('"visit_status"');
    expect(listing).toContain('"visit_reply"');
    expect(read("../../components/activity-feed.tsx")).toContain('case "visit_status"');
    expect(read("../propiedades/[id]/page.tsx")).toContain('case "visit_reply"');
    const chip = read("../../components/propiedades/chip.tsx");
    expect(chip).toContain("function VisitChip");
    for (const status of VISIT_STATUSES) expect(chip).toContain(`${status}:`);
    expect(read("./[id]/page.tsx")).not.toContain("Panel");
  });
});
