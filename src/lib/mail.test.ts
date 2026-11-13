import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailAddress } from "./visit-plan";
import { mailerFromEnv, readInbound } from "./mail";

const PROJECT = "550e8400-e29b-41d4-a716-446655440000";
const TOKEN = "ab".repeat(32);
const SECRET = "inbound-secret";

const to = emailAddress("anunciante@example.com");
if (!to.ok) throw new Error("email");

const letter = {
  to: to.email,
  from: `Casa En Comú <visitas+${PROJECT}.${TOKEN}@visitas.example>`,
  replyTo: `visitas+${PROJECT}.${TOKEN}@visitas.example`,
  subject: "¿Sigue disponible?",
  text: "Hola\nRef: x",
  idempotencyKey: "ask:1:1",
  messageId: "<ask.1.1@visitas.example>",
};

function inbound(body: unknown, secret = SECRET) {
  return new Request("http://localhost/api/visitas/entrada", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mailerFromEnv", () => {
  it("writes the letter to stdout and returns log plus the key", async () => {
    const connect = vi.spyOn(net, "connect").mockImplementation(() => {
      throw new Error("socket");
    });
    const secure = vi.spyOn(tls, "connect").mockImplementation(() => {
      throw new Error("socket");
    });
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("socket");
    });
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const sent = await mailerFromEnv({ MAIL_REPLY_DOMAIN: "visitas.example" }).send(letter);
    expect(sent.providerMessageId).toBe("log:ask:1:1");
    expect(lines.join("")).toContain("¿Sigue disponible?");
    expect(lines.join("")).toContain("anunciante@example.com");
    expect(lines.join("")).toContain("Hola");
    expect(connect).not.toHaveBeenCalled();
    expect(secure).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("sends the envelope as From and keeps Reply-To when Resend is configured", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const sent = await mailerFromEnv({
      MAIL_TRANSPORT: "resend",
      MAIL_REPLY_DOMAIN: "visitas.example",
      MAIL_ENVELOPE: "casa@example.com",
      RESEND_API_KEY: "test-key",
    }).send(letter);
    expect(sent.providerMessageId).toBe("re_1");
    const init = fetched.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("ask:1:1");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "casa@example.com", reply_to: letter.replyTo });
  });

  it("refuses SMTP without a host", () => {
    expect(() => mailerFromEnv({ MAIL_TRANSPORT: "smtp", MAIL_REPLY_DOMAIN: "visitas.example" })).toThrow(/SMTP/);
  });
});

describe("readInbound", () => {
  const env = { MAIL_INBOUND_SECRET: SECRET, MAIL_REPLY_DOMAIN: "visitas.example" };

  it("returns 401 when the secret is missing or a different length", async () => {
    const missing = await readInbound(inbound({}), { MAIL_REPLY_DOMAIN: "visitas.example" });
    expect(missing).toEqual({ ok: false, status: 401 });
    const wrong = await readInbound(inbound({}, "short"), env);
    expect(wrong).toEqual({ ok: false, status: 401 });
  });

  it("routes the recipient and then the last Ref line", async () => {
    const addressed = await readInbound(
      inbound({
        providerMessageId: "reply-1",
        to: `Visitas+${PROJECT}.${TOKEN}@visitas.example`,
        text: "Podemos el martes.",
        inReplyTo: "<old@example.com>",
      }),
      env,
    );
    expect(addressed).toMatchObject({ ok: true, projectId: PROJECT, token: TOKEN, providerMessageId: "reply-1" });
    const ref = await readInbound(
      inbound({
        providerMessageId: "reply-2",
        to: "other@example.com",
        text: `Gracias\nRef: ${PROJECT}.${TOKEN}\n`,
        inReplyTo: null,
      }),
      env,
    );
    expect(ref).toMatchObject({ ok: true, projectId: PROJECT, token: TOKEN });
  });

  it("returns 404 when the letter has no route and 400 when Resend cannot fetch the text", async () => {
    const missing = await readInbound(
      inbound({ providerMessageId: "reply-3", to: "other@example.com", text: "Hola", inReplyTo: null }),
      env,
    );
    expect(missing).toEqual({ ok: false, status: 404 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 404 }));
    const fetched = await readInbound(
      inbound({ data: { email_id: "re_in", to: [`visitas+${PROJECT}.${TOKEN}@visitas.example`] } }),
      { ...env, MAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-key" },
    );
    expect(fetched).toEqual({ ok: false, status: 400 });
  });
});

describe("the deliver timer", () => {
  it("hands unsent letters to act and leaves recheck off the visit tables", () => {
    const timer = readFileSync(new URL("../instrumentation.ts", import.meta.url), "utf8");
    expect(timer).toContain('act({ type: "deliver" })');
    expect(readFileSync(new URL("./recheck.ts", import.meta.url), "utf8")).not.toContain("visit.ts");
    expect(readFileSync(new URL("./enrich.ts", import.meta.url), "utf8")).not.toContain("visit.ts");
  });
});
