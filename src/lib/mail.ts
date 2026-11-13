import { timingSafeEqual } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { z } from "zod";
import { INBOUND_CHARS, type Email } from "./visit-plan";

export type OutboundMail = {
  to: Email;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  messageId: string;
};

type Mailer = {
  send(mail: OutboundMail): Promise<{ providerMessageId: string }>;
};

export type MailConfig =
  | { transport: "log"; envelope: string | null }
  | { transport: "resend"; envelope: string | null; apiKey: string }
  | { transport: "smtp"; envelope: string | null; host: string; port: number; user: string; password: string };

export type InboundBody = {
  providerMessageId: string;
  to: string;
  text: string;
  inReplyTo: string | null;
};

export type InboundRead =
  | {
      ok: true;
      projectId: string;
      token: string;
      providerMessageId: string;
      text: string;
      inReplyTo: string | null;
    }
  | { ok: false; status: 400 | 401 | 404 };

type Env = { readonly [key: string]: string | undefined };

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TOKEN = "[0-9a-fA-F]{64}";
const ADDRESS = new RegExp(`visitas\\+(${UUID})\\.(${TOKEN})@`, "i");
const REF = new RegExp(`^Ref:\\s*(${UUID})\\.(${TOKEN})\\s*$`, "i");

const EnvShape = z.object({
  MAIL_TRANSPORT: z.enum(["log", "resend", "smtp"]).default("log"),
  MAIL_REPLY_DOMAIN: z.string().min(1),
  MAIL_ENVELOPE: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
});

const Direct = z.object({
  providerMessageId: z.string(),
  to: z.string(),
  text: z.string(),
  inReplyTo: z.string().nullable().optional(),
});

const Received = z.object({
  data: z.object({
    email_id: z.string().min(1).max(200),
    to: z.union([z.string(), z.array(z.string()).min(1)]),
    text: z.string().optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
  }),
});

function readConfig(env: Env): MailConfig {
  const transport = env.MAIL_TRANSPORT?.trim();
  const parsed = EnvShape.safeParse({
    MAIL_REPLY_DOMAIN: env.MAIL_REPLY_DOMAIN?.trim(),
    MAIL_ENVELOPE: env.MAIL_ENVELOPE?.trim() || undefined,
    RESEND_API_KEY: env.RESEND_API_KEY,
    SMTP_HOST: env.SMTP_HOST?.trim(),
    SMTP_PORT: env.SMTP_PORT?.trim(),
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    ...(transport ? { MAIL_TRANSPORT: transport } : {}),
  });
  if (!parsed.success) throw new Error("mail is not configured");
  const cfg = parsed.data;
  const envelope = cfg.MAIL_ENVELOPE ?? null;
  if (cfg.MAIL_TRANSPORT === "resend") {
    if (!cfg.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    return { transport: "resend", envelope, apiKey: cfg.RESEND_API_KEY };
  }
  if (cfg.MAIL_TRANSPORT === "smtp") {
    const port = Number(cfg.SMTP_PORT);
    if (!cfg.SMTP_HOST || !cfg.SMTP_USER || !cfg.SMTP_PASSWORD || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP is not configured");
    }
    return { transport: "smtp", envelope, host: cfg.SMTP_HOST, port, user: cfg.SMTP_USER, password: cfg.SMTP_PASSWORD };
  }
  return { transport: "log", envelope };
}

function sameSecret(presented: string, secret: string) {
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length) : "";
}

function providerOk(value: string) {
  return value.length >= 1 && value.length <= 200 && !/\s/.test(value);
}

function routeOf(to: string, text: string) {
  const addressed = to.match(ADDRESS);
  if (addressed) return { projectId: addressed[1].toLowerCase(), token: addressed[2].toLowerCase() };
  const last = text.trim().split(/\r?\n/).at(-1) ?? "";
  const ref = last.match(REF);
  if (!ref) return null;
  return { projectId: ref[1].toLowerCase(), token: ref[2].toLowerCase() };
}

function headerOf(headers: Record<string, unknown> | undefined, name: string) {
  if (!headers) return null;
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return typeof found?.[1] === "string" && found[1] ? found[1] : null;
}

function directBody(json: unknown): InboundBody | null {
  const parsed = Direct.safeParse(json);
  if (!parsed.success || !providerOk(parsed.data.providerMessageId)) return null;
  return { ...parsed.data, inReplyTo: parsed.data.inReplyTo ?? null };
}

async function resendBody(json: unknown, env: Env): Promise<InboundBody | null> {
  const direct = directBody(json);
  if (direct) return direct;
  const event = Received.safeParse(json);
  if (!event.success) return null;
  const data = event.data.data;
  const to = Array.isArray(data.to) ? data.to.join(", ") : data.to;
  let text = data.text ?? null;
  let inReplyTo = headerOf(data.headers, "in-reply-to");
  if (text === null) {
    const key = env.RESEND_API_KEY?.trim();
    if (!key) return null;
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const fetched = (await res.json()) as { text?: unknown; headers?: Record<string, unknown> };
    if (typeof fetched.text !== "string") return null;
    text = fetched.text;
    inReplyTo ??= headerOf(fetched.headers, "in-reply-to");
  }
  return { providerMessageId: data.email_id, to, text, inReplyTo };
}

export async function readInbound(request: Request, env: Env = process.env): Promise<InboundRead> {
  const secret = env.MAIL_INBOUND_SECRET;
  if (!secret || !sameSecret(bearer(request), secret)) return { ok: false, status: 401 };
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { ok: false, status: 400 };
  }
  const transport = env.MAIL_TRANSPORT?.trim() || "log";
  const body = transport === "resend" ? await resendBody(json, env) : directBody(json);
  if (!body) return { ok: false, status: 400 };
  const text = body.text.slice(0, INBOUND_CHARS);
  const routed = routeOf(body.to, text);
  if (!routed) return { ok: false, status: 404 };
  return { ok: true, ...routed, providerMessageId: body.providerMessageId, text, inReplyTo: body.inReplyTo };
}

function logSend(mail: OutboundMail) {
  process.stdout.write(`${mail.subject}\n${mail.to}\n${mail.text}\n`);
  return { providerMessageId: `log:${mail.idempotencyKey}` };
}

async function resendSend(apiKey: string, mail: OutboundMail) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "Idempotency-Key": mail.idempotencyKey,
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      reply_to: mail.replyTo,
      headers: { "Message-ID": mail.messageId },
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new Error("resend id");
  return { providerMessageId: body.id };
}

function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

function encodeHeader(value: string) {
  const line = oneLine(value);
  return /^[\t\x20-\x7e]*$/.test(line) ? line : `=?UTF-8?B?${Buffer.from(line, "utf8").toString("base64")}?=`;
}

function encodeFrom(value: string) {
  const line = oneLine(value);
  const match = line.match(/^(.*)<([^>]+)>\s*$/);
  if (!match) return encodeHeader(line);
  const name = match[1].trim();
  return name ? `${encodeHeader(name)} <${match[2]}>` : `<${match[2]}>`;
}

function addressOf(header: string) {
  const angled = header.match(/<([^>]+)>/);
  return (angled?.[1] ?? header).trim();
}

function dotStuff(text: string) {
  return text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function smtpSend(
  cfg: { host: string; port: number; user: string; password: string },
  mail: OutboundMail,
): Promise<{ providerMessageId: string }> {
  const data = [
    `From: ${encodeFrom(mail.from)}`,
    `To: ${oneLine(mail.to)}`,
    `Reply-To: ${oneLine(mail.replyTo)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Message-ID: ${oneLine(mail.messageId)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(mail.text),
    ".",
  ].join("\r\n");
  return smtpSession(cfg, addressOf(mail.from), mail.to, data + "\r\n").then(() => ({
    providerMessageId: `smtp:${mail.idempotencyKey}`,
  }));
}

// Port 465 is already TLS. Any other port sends AUTH only after STARTTLS when the server offers it.
function smtpSession(
  cfg: { host: string; port: number; user: string; password: string },
  from: string,
  to: string,
  data: string,
) {
  return new Promise<void>((resolve, reject) => {
    let buffer = "";
    let secure = cfg.port === 465;
    let stage = "greet";
    let done = false;
    const opened = cfg.port === 465
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    let socket: net.Socket = opened;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const send = (line: string) => {
      socket.write(`${line}\r\n`);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const end = buffer.lastIndexOf("\n");
      if (end < 0) return;
      const lines = buffer.slice(0, end).split(/\r?\n/).filter((line) => line.length > 0);
      const last = lines[lines.length - 1] ?? "";
      if (!/^\d{3} /.test(last)) return;
      buffer = buffer.slice(end + 1);
      const code = Number(last.slice(0, 3));
      if (code >= 400) return finish(new Error(`smtp ${code}`));
      if (stage === "greet") {
        stage = "ehlo";
        send("EHLO casaencomu");
      } else if (stage === "ehlo") {
        if (!secure && lines.some((line) => /STARTTLS/i.test(line))) {
          stage = "starttls";
          send("STARTTLS");
          return;
        }
        stage = "auth";
        send("AUTH LOGIN");
      } else if (stage === "starttls") {
        const plain = socket;
        plain.removeAllListeners("data");
        const upgraded = tls.connect({ socket: plain, servername: cfg.host });
        socket = upgraded;
        secure = true;
        buffer = "";
        stage = "ehlo";
        upgraded.on("data", onData);
        upgraded.on("error", (error) => finish(error));
        upgraded.setTimeout(20_000, () => finish(new Error("smtp timeout")));
        upgraded.once("secureConnect", () => send("EHLO casaencomu"));
      } else if (stage === "auth") {
        stage = "user";
        send(Buffer.from(cfg.user).toString("base64"));
      } else if (stage === "user") {
        stage = "pass";
        send(Buffer.from(cfg.password).toString("base64"));
      } else if (stage === "pass") {
        stage = "from";
        send(`MAIL FROM:<${from}>`);
      } else if (stage === "from") {
        stage = "to";
        send(`RCPT TO:<${to}>`);
      } else if (stage === "to") {
        stage = "data";
        send("DATA");
      } else if (stage === "data") {
        stage = "body";
        socket.write(data);
      } else if (stage === "body") {
        stage = "quit";
        send("QUIT");
      } else {
        finish();
      }
    };
    opened.setTimeout(20_000, () => finish(new Error("smtp timeout")));
    opened.on("data", onData);
    opened.on("error", (error) => finish(error));
  });
}

export function mailerFromEnv(env: Env = process.env): Mailer {
  const cfg = readConfig(env);
  return {
    async send(mail) {
      const from = cfg.envelope ?? mail.from;
      const letter = { ...mail, from };
      if (cfg.transport === "log") return logSend(letter);
      if (cfg.transport === "resend") return resendSend(cfg.apiKey, letter);
      return smtpSend(cfg, letter);
    },
  };
}
