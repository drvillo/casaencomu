# Visitas

_2026-11-13. How one household sets free hours, writes to an advertiser, and reads the reply.
`STATUS.md` holds the state of the whole project. This file is the mail and the webhook._

The code is in this tree. It is not a claim that the Air was updated.

---

## 1. What the app does

One property has one visit case. Each member stores the hours they can visit. For a home the
group wants, the app emails the advertiser, stores the reply, and picks a 30 minute slot that
fits those hours.

The screens are `/visitas`, `/visitas/<property id>`, and the section **Cuándo puedes visitar**
on `/ajustes`. The account menu links to Visitas. The header tabs are unchanged.

There is no task list. The task half of PIP-12 is not done.

---

## 2. Local mail

Leave `MAIL_TRANSPORT` empty. That selects the log transport.

The log transport writes three lines to stdout: the subject, the recipient, and the text. It
returns a provider id `log:` plus the idempotency key. It does not open a socket. Tests use this
transport, or an injected mailer. They do not call Resend or SMTP.

A letter is stored as `unsent` when `MAIL_REPLY_DOMAIN` is empty. The two-minute timer sends it after you set the domain. From and Reply-To are both

```
visitas+<projectId>.<token>@<MAIL_REPLY_DOMAIN>
```

The project id is a uuid. The token is 64 hex characters, stored on the case. Each letter ends
with `Ref: <projectId>.<token>`.

`MAIL_ENVELOPE`, when set, replaces the From header. Reply-To stays the visitas address.

---

## 3. Post a sample reply

The webhook is `POST /api/visitas/entrada`. The session proxy does not cover it. The route checks
`Authorization: Bearer <MAIL_INBOUND_SECRET>` with a constant-time compare. A missing secret is
401. A wrong secret is 401. An unknown project is 404 and creates no database file.

The body for the log and SMTP transports is JSON:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/visitas/entrada \
  -H "authorization: Bearer $MAIL_INBOUND_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "providerMessageId": "reply-1",
    "to": "visitas+PROJECT.TOKEN@visitas.example",
    "text": "Podemos el 18 de noviembre de 2026 a las 10:00.\nRef: PROJECT.TOKEN",
    "inReplyTo": null
  }'
```

Replace `PROJECT` with the project uuid and `TOKEN` with the case's reply token. The route reads
`to` first. If that address does not match, it reads the last line `Ref: <projectId>.<token>`.

A Resend `email.received` event is accepted only when `MAIL_TRANSPORT=resend`. If the event has
no text, the app fetches it from Resend. A failed fetch is 400 and writes nothing.

The same `providerMessageId` twice stores one inbound row and sends one confirmation.

---

## 4. SMTP and Resend

| `MAIL_TRANSPORT` | What it needs | What it does |
|---|---|---|
| empty or `log` | `MAIL_REPLY_DOMAIN` | Writes the letter to stdout |
| `resend` | `MAIL_REPLY_DOMAIN`, `RESEND_API_KEY` | Posts the letter to Resend with an `Idempotency-Key` |
| `smtp` | `MAIL_REPLY_DOMAIN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Sends one SMTP message |

Port 465 uses TLS from the start. Any other port sends the password only after STARTTLS, and
only when the server offers it.

SMTP does not open a mailbox. The app does not poll an inbox. A reply reaches the thread only
when something POSTs it to `/api/visitas/entrada`.

Outbound rows are inserted `unsent` before any send. A timer every two minutes delivers rows
that are still `unsent`. A throw leaves the row `unsent`.
