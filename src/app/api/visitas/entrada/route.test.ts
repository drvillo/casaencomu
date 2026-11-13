import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "casa-inbound-"));

const h = vi.hoisted(() => ({ inProject: vi.fn(), membersOf: vi.fn() }));
vi.mock("@/lib/control", () => ({ membersOf: h.membersOf }));
vi.mock("@/lib/db", () => ({
  inProject: h.inProject,
  db: {},
  currentProjectId: async () => "default",
}));

const { POST } = await import("./route");

function call(secret: string) {
  return POST(
    new Request("http://localhost/api/visitas/entrada", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ providerMessageId: "m-1", to: "a@b.example", text: "Hola", inReplyTo: null }),
    }),
  );
}

describe("POST /api/visitas/entrada", () => {
  it("returns 401 for a bad secret and does not open a project", async () => {
    vi.stubEnv("MAIL_INBOUND_SECRET", "correct-secret");
    const res = await call("wrong-secret");
    expect(res.status).toBe(401);
    expect(h.inProject).not.toHaveBeenCalled();
    expect(h.membersOf).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is missing and does not open a project", async () => {
    vi.stubEnv("MAIL_INBOUND_SECRET", "");
    const res = await call("correct-secret");
    expect(res.status).toBe(401);
    expect(h.inProject).not.toHaveBeenCalled();
  });

  it("leaves the webhook outside the session proxy", () => {
    const proxy = readFileSync(new URL("../../../../proxy.ts", import.meta.url), "utf8");
    expect(proxy).toContain("api/health|api/capture|api/visitas/entrada");
  });
});
