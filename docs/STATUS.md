# CasaEnComú — what is done, and what is not

## 2026-11-13 — Visit pipeline is in the tree

The shared visit pipeline is in this checkout. Members can store free hours, write to an
advertiser, and read the reply on `/visitas`. See `docs/VISITAS.md`.

The Air was not updated. This note is not a deploy. PIP-12's task half is not done.

## 2026-11-13 — Local demo repaired and populated from the Air

The local demo at `http://127.0.0.1:3120/propiedades` now uses a separate copy of the Air's data.
The Air's application, configuration and data were not changed. Its service remains healthy on
`readiness-20261112`. An original local snapshot is retained separately from the writable demo.

- Copied all 24 opportunities, 657 photos, 18 ratings, three comments, three opinions, one review
  and 81 existing events. The opportunities were first saved on September 7–8.
- Added ten missing links from the supplied chat. The demo now holds 34 opportunities and 694
  photos. Twenty-nine records have listing details. Five older links remain saved with a withdrawn
  page result. Historical Air observations keep their original dates.
- Fixed a development origin mismatch: Next normalizes its request URL to `localhost`, while
  the browser used `127.0.0.1`. Development requests now use their actual Host when no public
  origin is configured. An explicit `PUBLIC_URL` still wins. Foreign origins remain rejected.
- Idealista photo links and Vivalta search-context links now resolve to the same saved listing.
  A malformed import body returns a readable error. Blocked imports no longer mark an advert
  active or erase its saved photo URL metadata. Existing facts and family decisions survive.
- Pending pages now provide a direct link to capture instructions. The interface no longer
  promises automatic browser reading when that service is absent. Local demo URLs in capture
  instructions use port 3120. Server-side Idealista requests can still be blocked; browser capture
  is the supported completion path. Three additional Idealista records were filled from visible
  Safari text; their photographs were not captured. Two additional Fotocasa records supplied 37 photos.

Validation: 798 tests pass, with three existing skips. TypeScript and targeted ESLint pass.
HTTP checks cover health, catalogue, map, comparison and settings. A real browser form saved a
new Idealista link. Chrome submitted a Fotocasa duplicate and the server returned the existing
record. Capture requests filled the pending records in place. A photo-link duplicate preserved
the original property. Foreign origins received 403 responses.

All original property, photo, rating, comment, opinion, review and event rows remain in the local
copy. SQLite integrity and foreign-key checks pass; every retained photo file exists. Read-only
hash comparisons confirm the Air's property, photo, rating, comment, opinion and review tables
match the original snapshot. No commit, push or deployment was made for this demo repair.

Source changes remain in the readiness worktree. The running demo uses a disposable source copy
to avoid another development server's Next lock. Private snapshot, verification, launch and sync
instructions are in `_local/product-story-20261113/`. The earlier synthetic presentation data is
retained separately. The HTML/PDF presentation has not been changed to expose the restored data.

## 2026-11-12 — Deployed safety and operations release

**Release `readiness-20261112` is live on the Air.** It includes the first safety batch below and
the recovery/operations changes in this entry. Source remains uncommitted in the
`fix/readiness-account-data` worktree. No issue, commit, push or PR was created. Deployment used
`./deploy.sh` with the exact production image tested against a restored copy on the Air.

### What now works

- **HTTPS:** Tailscale Serve terminates HTTPS on the Air and forwards to the local app. Its actual
  HTTPS origin is now `PUBLIC_URL`. The old HTTP 8080 endpoint is removed. This remains tailnet-only;
  the public custom domain is not published. Secure cookies remain enabled.
- **Recovery:** each account holder can create a 256-bit recovery code in Ajustes after entering
  the current password. Only its digest is stored. The code lasts one year and can be used once.
  Recovery consumes it, changes the password and revokes sessions in one transaction. Replacing
  a code or changing a password revokes the previous code. No project owner can reset another account.
- **Anonymous identity:** public login, invitation and recovery pages strip incoming identity
  headers. Recovery-code issuance and password changes require a real session cookie.
- **Backups:** the nightly job includes all databases and retained photos. It briefly stops the
  writer, validates a complete snapshot, encrypts it with authenticated encryption, restores and
  verifies it, and publishes the archive atomically. Retention happens only after success.
- **Release recovery:** unique image tags, configuration/TLS preflight, a deployment lock, a verified
  pre-deploy backup, and retained previous image/environment/compose files. Migration rollback uses
  the matching restored data, never a blind image downgrade.
- **Health:** Compose checks actual database tables, data-volume space and a photo sample. An hourly
  operator check reports app failure, failed/stale backups and low disk space to a local log.

### Evidence

- **783 passing tests, 3 existing skips, 63 test files**; full ESLint and production build passed.
  The ARM64 Docker production build also passed. No npm dependencies were added.
- Local Chrome: recovery form, login link, existing-account sign-in and recovery settings rendered.
  Credential changes were tested through real HTTP form submissions against isolated staging.
- Live encrypted backup and restore: **24 properties, 657 photos**, SQLite integrity/foreign-key
  checks, table counts and file hashes verified. The actual backup LaunchAgent exited 0.
- Restored staging copy: migrated project schema 9 to 10, completed operator-key setup with a
  fictional account, issued Secure cookies, created/redeemed a recovery code, refused its reuse
  and the old password, rejected the old session, and accepted the new password over HTTPS.
- Rollback drill: a second original-schema restore booted with the retained older image at schema 9;
  property/photo counts stayed intact. Production was not replaced by either test copy.
- Post-deploy: HTTPS health and setup pages passed; Docker reports **healthy**; schema **10**,
  **24 properties**, **657 photos**, integrity **ok**. Temporary test services and copies removed.

Detailed local logs: `_local/release-tests.txt`, `release-lint.txt`, `release-build.txt`,
`docker-build.txt`, `air-staging-smoke.txt`, `air-backup-v2.txt`, `deploy-readiness.txt`.
Operator procedure: [air/README.md](../air/README.md). Release assets are on the Air under
`~/srv/casaencomu/releases/readiness-20261112/`. Actual addresses and machine-specific details
belong in ignored project memory, not this document.

### Still required

- **Create the first real account.** There are still zero accounts. The operator key is in
  `~/.config/casaencomu/setup.key` on the Air, mode 600. Enter it at the HTTPS setup page. After
  creation, store a recovery code in the password manager and remove the setup key from the running
  environment at the next controlled restart. No real user's password was chosen by this release.
- **Free internal disk space.** Only about 700 MB remained at the final check. The hourly monitor
  reports `internal_disk_below_2gb`. Restore scratch is external; backup destination capacity is
  checked before writing. The next backup can fail its space preflight until space is freed. All three new archives were
  confirmed uploaded to iCloud. macOS refused cache eviction; no archive was deleted.
- No email/push alert delivery is configured. Logs and nonzero job status require operator review.
- Real-phone use, real-account invitations and bookmarklet imports still need a household pilot.
  Staging verified login/recovery on the real HTTPS certificate; it did not create a production account.
- The wider multi-household gaps remain: project-aware navigation/media, capacity and reader scope,
  ownership transfer, export/leave/delete flows, visible import retries and old AI-failure repair.
  Recovery requires a code saved before a password is lost; no email service or owner-issued reset exists.

## 2026-11-12 — First safety batch (implemented before the release)

Implementation is in the local `fix/readiness-account-data` worktree, based on `08a68cc`.
At that point it had not been committed, merged or deployed. The release above now includes it.
Historical deployment descriptions below still refer to the older behavior. In particular, invitation links no longer reset passwords.

- First-account setup requires an operator-held `CASA_SETUP_TOKEN`. Account creation, the
  one-time installation claim and legacy-project adoption are one transaction.
- Invitation signup creates only a new account. Existing accounts authenticate normally to join.
  Validation, token consumption and membership creation are atomic. No invitation changes a password.
- Local opinion/comment drafts carry account and project ownership. Account switching and logout
  remove old text. Server actions refuse stale forms from a different account or selected project.
- Rechecks share the import merge rules, retain missing facts and provenance, and use guarded,
  size-limited fetches. Capture requests enforce the byte limit while reading the stream.
- Enrichment uses a bounded model-call deadline, delayed retries and expiring worker claims.
  A new observation invalidates an older AI result. Successful empty output completes normally.
- Account error messages live outside server-action modules. Browser testing exposed the previous
  non-function export as a runtime login error despite a successful build.

Project schema migration 10 adds observation versions and enrichment retry/claim columns.
It runs through the existing migration runner. Initial setup now needs the new environment key.
Existing accounts retain their passwords and sessions. Unscoped browser drafts are discarded,
because their ownership cannot be established. Server-saved drafts are retained.

Validation: **768 tests passed, 3 existing skips, 60 test files**. Full repository ESLint and the
production Turbopack build passed, including TypeScript. No dependencies were added.

Old sources marked complete before this fix are not automatically requeued. Their saved state
does not distinguish a failed AI call from valid empty output. Revisit this when checking live data.

Local Chrome checks used fictional accounts and a separate temporary dataset: sign-in, unsent
comment/opinion recovery after reload, logout, switching accounts, normal opinion publication,
and the existing-account invitation sign-in screen. Real phones and the Air remain unverified.

The readiness review's wider release gates remain open: independent password recovery, visible
retry controls, project-aware navigation/media, household capacity and reader scope, ownership
and data lifecycle, HTTPS, complete backups, recovery/rollback and operational monitoring. This
batch fixes the reproduced core failures; it does not certify production readiness.


_2026-09-15. This file answers one question: **what is the real state right now?**
`WORKPLAN.md` holds the plan and the order. This holds the state. When they disagree, this one
is newer — check the dates._

Every claim below names the pull request, the issue, or the command that proves it. A line with
no evidence is not a claim, it is a plan, and it belongs in `WORKPLAN.md`.

---

## 1. In one paragraph

**The app has its own login, and it is deployed behind it.** A person signs in at `/entrar` with
an address and a clave. The first account on an empty server adopts every project it finds, so
the 23 flats are there when the owner lands rather than hidden behind a second, empty project.
Ten accounts is the ceiling, enforced by a database trigger, not only by a count. Every account
after the first arrives through an invitation, and the same link sets a new clave for somebody
who has forgotten theirs — there is no mail server, so a reset is a link the owner hands over.
`main` is green at **714 tests, 3 skipped**, with lint, types and build clean.

Release A and Release B are both finished, merged and deployed. What a person thinks is
published, versioned, drafted and withdrawable; the family average counts people rather than
rating rows; the conversation takes replies, corrections and removals; the top bar carries the
account; the activity feed stays unread until somebody presses a button; the facts panel names
what is missing instead of printing «Sin datos» twelve times; and the budget says whose decision
it was.

**It is deployed and the data is backed up.** The Air runs the current image. The nightly backup
is installed and a restore has been carried out (#21). Every route answers in under 25 ms.

**It is not on a domain yet, and that is deliberate.** The domain is bought, the tunnel is healthy
and its route is configured, but no DNS record is published: the first account claims the server,
so the hostname must not be reachable before that account exists. The tailnet is still the only
way in. **Read `docs/RELEASE-B-PROOF.md` § 5** for the things nobody has checked — a real phone
has never opened this app.

---

## 2. What is running right now

| | |
|---|---|
| Where | The MacBook Air, in Docker under Colima |
| Reachable from | The tailnet only, over plain HTTP on port 8080 |
| Login | **The app's own.** An address and a clave at `/entrar`; no account exists yet |
| Data | A **copy** of the Pro's development database: 23 properties, 621 photos |
| Survives a reboot | Yes, on its own |

The address, the clave location and the exact commands are in `memory/decisions.md`. `memory/` is
gitignored on purpose: the address names the machine.

**What this is not:**

- It is **not** public. The tunnel is healthy and its route is set, but no DNS record points at
  it. Publishing that record is the last step, and it waits on the first account.
- It is **not** a Cloudflare Access deployment, and it no longer needs to be. Access still works
  as an outer gate when `CF_ACCESS_*` is set, but the app no longer depends on it to know who
  anybody is. `PREVIEW_OPEN_AS` and `PREVIEW_PASSWORD` are commented out of the Air's `.env`
  («removed 2026-09-12: the app has its own login (#166)»), so our login is the only door.
- The database on the Air is a **copy**. The Pro's `data/` is still the source of truth. Do not
  start editing on the Air and expect it to come back.
- It is **not** HTTPS. The tailnet has no HTTPS certificates enabled. Traffic is still
  WireGuard-encrypted between tailnet devices, and the application uses no browser feature that
  needs a secure context. See § 7 for the one-toggle upgrade.

---

## 3. Done and merged to `main`

`main` is green in the canonical checkout: **714 tests pass, 3 skip, in 51 files**; `eslint`, `tsc --noEmit`
and `next build` are all clean.

### The base application, before this round

Issues #6–#17, plus the two themes and the day/night toggle (#53), the generic-portal extractor
and the four bugs it exposed (#57), three more photo hosts (#59), the repository layout (#62)
and the cold-start fix (#64). `WORKPLAN.md` § 0 records that history.

**The database is real.** 23 of the family's 25 links are imported, every field taken from the
advertisement by the extractor. The two that fail are genuinely withdrawn.

### PIP-01 · Reliable import and recapture — issue #65, PR #66

- `fetching.ts`: one guarded fetch for every outbound request. HTTPS only, no credentials in the
  URL, no port, host allow-list, redirects checked **before** each hop, a byte cap that works
  without a `content-length`.
- A failed re-read no longer erases a field. `extract.ts` reports which fields were *present* in
  the page, and `save.ts` keeps the stored value for any field that was absent.
- `duplicate` is gone. Re-importing the same link now **refreshes** it and reports
  `created` / `updated` / `unchanged`.
- Photos are capped **per property**, not per call, and record the URL they came from, so a
  refresh cannot download the same photograph forever.

Verified against the real 23-property database: a second ingest added 0 events and 0 photos.

### PIP-03 · Tokens and accessible controls — issue #67, PR #68

- The full token table from the design document, in both themes.
- `globals.test.ts` computes **WCAG 2.2 contrast from the shipped stylesheet**, unrounded, and
  fails on any text pair below 4.5:1 or non-text pair below 3:1. It also asserts that the two
  night blocks are identical, and scans the source for banned patterns.
- A visible focus ring on every control, 44 px targets, and a `prefers-reduced-motion` block.
- `DESIGN.md` updated, as the proposal's instruction 7 requires.

### PIP-02 · Availability separate from the shared stage — issue #70, PR #71

**This one changed the data model.** Availability and the family's decision used to be the same
field, so a portal delisting a home wrote `no_disponible` over `preseleccionada` and the decision
was gone.

- Removal now needs **two consecutive scheduled checks that agree**. A block, a timeout or a
  success resets the streak. A manual check never casts the confirming vote.
- A property is as available as its **best** source. One portal still carrying it keeps it
  available.
- `recheck.ts` no longer writes `properties.stage` at all.
- Migration v3 **restores what was already lost**: only a member ever wrote a `stage_change`
  event, so the last one they wrote is exactly the decision that got buried.

Verified on a copy of the real database: a property staged `no_disponible` came back as
`preseleccionada`, 23 properties and sources intact.

### Preview auth — issue #72, PR #73

A third mode in `proxy.ts`, used **only** when the two Cloudflare Access values are absent.
Cloudflare wins when it is configured, so this can never weaken a real deployment. Details in
§ 2 above and in the PR.

### One fix — PR #69

`main` went red after the first two merges. `globals.test.ts` walked
`new URL(...).pathname`, which is percent-encoded; the worktrees are on an ASCII path so it
passed there, and the canonical checkout is under `Claude Projects/…/CasaEnComú`, so it became
`%20` and `%C3%BA`. Also excluded `node_modules.nosync` from `tsconfig.json`, because a bare
`tsc --noEmit` was type-checking all of `maplibre-gl`.

**The lesson is worth keeping: a worktree outside iCloud is not a faithful copy of the checkout
people actually use.** Run the checks in the canonical checkout before calling a branch green.

---

## 4. The rest of Release A — merged 2026-09-08

### PIP-04 · Stable, fully themed map — issue #75, PR #76

A vendored 55-layer style snapshot with a role manifest that **throws** on an unmapped layer, so
a light default can never ship silently again. The map is built once and repainted on a theme
change rather than rebuilt. Pins are buttons, so the keyboard reaches them.

### PIP-05 · One search and context contract — issue #78, PR #79

Four surfaces each decided which homes qualify and no two agreed. `src/lib/filters.ts` is now the
only place that answers it; two tests fail if either page grows a query of its own. `/api/markers`
was deleted — nothing called it. Also: one cover rule, one archive policy, links that carry every
filter, a detail page that returns to the list it came from, independent budget bounds, and labels
that say what the filters actually do.

Two older defects surfaced while verifying it: `ORDER BY created_at` ran on the outer statement
and failed for any caller that had not selected that column; and the budget fields rendered with a
corrupted `class` attribute, because a server component imported the shared field style from a
`"use client"` module. Building map markers field by field instead of spreading the row also took
the search haystack out of the browser — **the map page's payload fell from 76 KB to 30 KB**.

### Map popups keep the filters — issue #80, PR #81

PIP-05 could not touch `Mapa.tsx` while PR #76 owned it. Opening a home from a pin and pressing
back landed on an unfiltered list.

### PIP-06 · Usable comparison selection — issue #82, PR #83

`/comparar` accepted two to four identifiers and **nothing in the application selected them**;
the empty page asked a family member to compose a URL by hand. There is now a checkbox on every
card, row and detail page, outside the link rather than inside it, and a tray that states the
count, refuses a fifth without evicting anything, and says how many of the chosen homes the
filters are hiding. Differences are decided on raw typed values, so a rounded €/m² no longer hides
a real one. A phone shows two columns at a time without losing the other two.

### PIP-08 · Saving, errors, and purposeful motion — issue #84, PR #85

The add form threw the typed URL away on failure and posted Idealista links to a server fetch
that answers 403 every time. Links are now classified in the browser first, failures stay
in place with the URL still in the field, and there is one honest pending state. (The dialog this
package introduced was replaced on the same day — see § 4a; everything else here survived it.) A stage
change carries the version it was drawn from, so two people deciding at once no longer means the
later write wins in silence — **verified: the refused write left the database untouched and wrote
no event**. A refused comment comes back with its text. `error.tsx`, `not-found.tsx` and
`loading.tsx` exist, so no flow reaches a framework default.

F18 needed no work: PIP-03 had already removed the card zoom and the pin scale under reduced
motion and cut the theme wipe from 520 ms to 320 ms. It is now covered by a test instead.

### Two defects of my own, found and fixed the same day

The comparison checkbox was positioned by a Tailwind utility that lost to `.compare-toggle`'s own
`position: relative` — same specificity, my rule later in the file — so it rendered above the card;
fixing that put it over the title. The card's photo and title are now separate links to the same
home, which is what document 02 § 4 asks for, so the control sits on the photograph without being
inside an anchor.

### `ingest.mts` credited a flag — issue #74, PR #86

`args[args.indexOf("--user") + 1]` reads `args[0]` when the flag is absent, so `--reset` owned all
23 import events in the Actividad feed. `vitest.config.ts` now also collects `scripts/**`.

---

## 4a. Kenobi's first look at the preview — issue #88, merged 2026-09-08

He opened the 09-08 preview on a 27-inch screen and sent seven items. All seven are done.

**The add control is the old one again.** The `+` stays where it is and grows a link field
leftwards out of itself; the search field yields the width, and on a phone it steps aside. PIP-08's
dialog is deleted, and `components/ui/dialog.tsx` with it. What PIP-08 actually fixed is untouched
and now lives inside that control: the link is still classified before anything is sent, a failure
still keeps what was typed, and the message sits under the pill where it cannot change the field's
height. **Verified in a browser:** an Idealista link is refused without a request, a Fotocasa link
that does not exist comes back with its message and the link still in the field.

**The theme has two states.** `sistema` is gone, and with it the screen glyph and the standing
subscription to the operating system. A first visit still opens in whatever the system reports;
after that the switch decides. An older `sistema` value in `localStorage` reads as "no choice yet",
so nothing needs migrating.

**The circular reveal runs again.** It was skipped whenever a map was on screen — which is both
pages that have one, so it almost never ran. The reason given was that a map cannot be captured by
a view transition. **That is not true in Chrome:** the wipe was slowed to six seconds and
photographed mid-sweep on `/propiedades`, and the map is in both the old and the new snapshot, in
the right theme on each side of the circle. The guard is deleted.

**The page uses the screen it is given.** The container goes from 1440 px to 2040 px, the map beside
the list from 42% to 46%, and the gallery never shows a third column — two cards, however wide the
screen. `/comparar` keeps 1440: four columns do not want more.

**The areas on the map are visible without a cursor on them.** They rested at `fill-opacity: 0`
behind a solid hairline in `--map-boundary` — the same grey, at the same width, that the basemap
draws streets in, so a district read as one more road. The first fix made the outline dashed; he
did not want a dash. See § 4b.

**Not checked:** the phone and tablet widths, again. The browser automation cannot change the
layout viewport. The wide layout was confirmed by driving the page at an effective 2749 px through
CSS zoom, which exercises `max-width` and the grid but not the `min-width` media queries.

## 4b. The area overlay, the way a portal draws it — issue #90, merged 2026-09-08

The dashed boundary of § 4a lasted one look. What he asked for instead is what Idealista does: a
continuous, thick line around every zone so its edges are obvious with nothing hovered, and a
low-opacity wash plus a thick line in the accent colour under the cursor. Near-black by day. On
the night map "black" is not a line, so the same role is a near-white.

**Every colour is a token, and the tokens are together.** `--map-area-line`, `--map-area-active`
and `--map-area-fill-active` in `globals.css`, three lines per theme. Changing the overlay to a
different colour is an edit there and nothing in `components/mapa/Mapa.tsx`; a test fails if a raw
hex or a non-`--map-area-*` token appears in the paint function. Two limits the tokens carry:
MapLibre paints on a canvas, so a token must resolve to a plain colour — **a CSS gradient will not
render** — and the resting colour has to differ per theme.

**One console error fixed on the way.** `startViewTransition` rejects `ready` as well as `finished`
whenever the browser skips a transition. Only `finished` was caught, so a skipped wipe raised
"Transition was aborted because of invalid state" in the console and lit Next's dev overlay. It was
invisible before § 4a, because the wipe was suppressed on exactly the pages that could skip it.

**Open, for his eyes:** on the night map the near-white boundary is the same brightness family as
the major roads. In daylight the near-black is unambiguous. If it reads as busy at night, the fix
is one hex in `globals.css`.

## 4c. Zones for any country, not just Barcelona — issue #92

`public/areas.geojson` held Barcelona and nothing else: ten districts and 73 barris, from a
Barcelona-only source, drawn by two hardcoded level names. The app is meant to work wherever the
family looks, so the geography had to stop being one city.

**A zone now carries a rank, not a Spanish word.** `rank` is 1 to 6, widest first, and it means
the same thing everywhere: Spain's comarca and Germany's Amt are both rank 3. The map gives each
rank a zoom band, so a region shows while the country is in view and barris show once you are
looking at streets. `parent` is the id of the smallest zone above it — worked out from the
geometry, because OSM does not reliably say. It is not always one rank up: a barrio in a town with
no districts hangs off the municipality. `district` is gone.

**One script, one config file per country.** `scripts/build-areas.mts` walks a country top down
and writes the file the map reads. `scripts/areas/es.json` is six lines that say which OSM
`admin_level` is which rank, how hard to simplify it, and how wide a net to cast when asking.
Adding Germany is another six lines and no code. `--probe` prints what each administrative level
of a country actually holds, which is the one thing a new country has to be told.
`scripts/areas/README.md` is the whole procedure.

**Measured, on Catalonia, at all six levels.** One comunidad, 4 provincias, 43 comarcas, 737
municipios, 124 distritos and 404 barrios — 1,313 zones, 1.4 MB on disk and 386 KB over the wire.
(§ 4d cuts this to the three comarques around Barcelona and rebuilds the file; the counts there are the current ones.)
Barcelona is complete and correct: a point on the Sagrada Família falls inside `Catalunya ›
Barcelona › Barcelonès › Barcelona › l'Eixample › la Sagrada Família`, and a test asserts exactly
that. About 200 rural municipalities were missing at this point, in eleven inland comarcas — first
because the endpoint rate-limited us, then because the connection to it from this machine started
refusing outright (`ECONNREFUSED` in a fifth of a second, with `curl` to the same host working).
None of them is inside the scope § 4d settled on, so the gap no longer matters; it would return if
that scope ever widened, and the cure is the same run on a better connection.

**What the two upstream services are for.** Overpass answers which zones exist — names and ids
only, one query per parent area. Asking it for every municipality of a region at once answers
504; asked comarca by comarca it answers in seconds. `polygons.openstreetmap.fr` answers the
shape of one zone. Every response is cached under `_local/overpass/`, so a second run costs
nothing and an interrupted run resumes. (§ 4d changed what tolerance the shape is asked for, and
where it is made small.)

**Three things went wrong and are now written into the script.**

- Rotating between Overpass mirrors is unsafe. An `area:` query needs an areas index, and a
  mirror that does not build one answers `200` with an empty result instead of an error — "43
  comarques" became "0 comarques", and it was cached. One endpoint now, and an empty answer is
  never cached.
- `overpass-api.de` resolves to several addresses and not all of them are reachable from here;
  `fetch` fails in half a second while `curl` to the same name succeeds. A connection that never
  opened is retried at once; a server that answered 429 or 504 is given a minute.
- A question that goes unanswered eight times is a gap, not a crash. The run says which ones, and
  a second run asks only those.

**The zone you select is now drawn at every zoom.** Fitting the map to a comarca lands at about
z10.7, which is inside the municipality band and not the comarca one, so the outline you had just
clicked disappeared. A layer with no zoom limits draws the selected zone, and the banded layers
give that one feature up to it so it is never stroked twice.

**The active filter reads as a chain**: `Catalunya › Barcelona › Barcelonès › Barcelona ›
Eixample`, from `areaChain` in `lib/areas.ts`. A barri's name alone does not say which city it is
in, and once there is more than one city that matters.

**Ceilings, written down in `scripts/areas/README.md`.** One file for the whole world will not
work — every visitor downloads all of it. The next step, when it hurts, is one file per rank and
the map fetching a rank when its band opens; nothing else in the app changes. The simplification
per rank is set by eye. Names come out of OSM in the local language, which is right for Catalonia
and would be wrong somewhere else.

**Ingest did not need changing, and that is the finding.** `extract.ts` is not Spanish: it reads
JSON-LD, then OpenGraph, then the text around the price. What is country-specific is three lines
in `lib/url.ts` per portal — whether a server fetch works, the SSRF allowlist, and the photo
host — plus a reference pattern and one fixture. `docs/PORTALS.md` § 3 is that procedure. Six
portals do not earn a plugin system.

## 4d. One border, one line, and only around Barcelona — issue #94

From about z14 up, every border between two zones of the same rank was drawn **twice**, a few
metres apart. With one of the two selected, a gold line and a black line ran side by side down the
same street and crossed each other, and neither followed the street.

**The cause was in the build, not in the map.** `build-areas.mts` generalised every zone on its
own, twice over: once in the request to `polygons.openstreetmap.fr`, and once locally with
Douglas-Peucker. Two neighbours share one border in OpenStreetMap — the same ways, the same nodes —
but each copy of it was simplified without knowing about the other, so each kept different points.
On the six barris of l'Eixample as shipped: **the middle border vertex was 6.9 m from the
neighbour's outline, the ninth in ten was 15.9 m, and not one of them landed on it.** At z17 that
is twenty pixels.

No per-shape algorithm can fix this. Douglas-Peucker's answer depends on where the ring starts and
which way round it runs, so two copies of one line drift apart by construction.

**The whole rank is now generalised in one pass** (`align()`, on mapshaper). `snap` collapses the
near-identical vertices of the two copies into one, which makes the border a single arc that both
zones point at; the arc is simplified once. Five metres of snapping, measured: OSM's own two copies
sit one to two metres apart, and at two metres seven in ten border vertices were still the zone's
own alone. Now **the middle border vertex is exact and four in five are shared outright**, and what is
left is OSM's own disagreement, under two metres. `src/lib/areas.test.ts` asserts both numbers and
fails on the old file.

The shapes are fetched at one metre for every rank, because the snap needs real vertices to match;
`tol` in `scripts/areas/<code>.json` is now the mapshaper interval and nothing else generalises.
`simplify()` and `shrink()` are gone. mapshaper is a devDependency — it runs in the build script
and no part of it reaches the browser.

**The map now covers the area the family is actually looking in, and nothing else.** Building the
whole of Catalonia was never asked for. `scripts/areas/es.json` gained a `scope` key — named areas
at one rank, kept whole with everything inside them:

```json
"scope": { "rank": 3, "names": ["Barcelonès", "Baix Llobregat", "Vallès Occidental"] }
```

Three comarques, which is Barcelona plus l'Hospitalet, Badalona, Santa Coloma, Sant Adrià,
Cornellà, Esplugues, Sant Cugat and fifty more. The build applies it twice: the unwanted comarques
are dropped before a single shape is asked for, and anything below that is not inside one of them
is pruned at the end. The ranks above it are kept whole, because the map needs a zone to draw in
every zoom band. Delete the key and the same file builds the whole country.

**398 zones — 1 comunidad, 4 provincias, 3 comarcas, 58 municipios, 67 distritos, 265 barrios.**
The file is **715 KB, 160 KB over the wire**, down from 1.4 MB and 386 KB, and that is with each
rank's tolerance now meaning what it says. The old file was generalised twice over, so its shapes
were far coarser than the number in the config claimed.

A shape that never arrives is now remembered. Three areas in Catalonia hang on every attempt, and
each of them cost eight four-minute timeouts on every rebuild — half an hour apiece, to be told
again what the last run already found out. Only shapes are remembered this way: a missing shape is
one area the map cannot draw, while a missing Overpass answer is a whole rank silently emptied.
`--fresh` asks them all again.

**It is checked from now on, and the checks now run by themselves.** `src/lib/areas.test.ts` has
two: one looks closely at six barris, and one counts exactly-shared points at *every* rank, which
is a hash and one pass over the file. Both fail on the file `main` shipped — at every rank its
median was zero, and no zone shared more than two points with anybody. Nothing ran them
automatically, so `.github/workflows/checks.yml` now runs types, lint, tests and the build on every
pull request and on every push to `main`.

**Two zones of different ranks still do not share their border.** A barrio's outer edge and its
district's edge are one line on the ground, and each rank is simplified on its own, so they sit a
few metres apart. The map only ever draws both at once for the zone you selected.

## 4e. The list view, and an open preview — issue #95

**The "Filas" view was a spreadsheet.** Eight narrow columns, no photograph, and a sideways
scrollbar under 640 px. It is now the gallery card laid on its side: the photograph on the left
(3:2, 128 px on a phone and 224 px beside the map), then the barrio, the title on at most two
lines, and `m² · hab.` The stage chip and the price sit at the foot of each row, so a column of
rows reads down the two things a decision is made on. Rows are separated by a hairline.

The score sits at the right of the title, and **Comparar** sits on the photograph, in the same
place as on the card. The budget warning is a chip with words: colouring the price red would say
it by colour alone.

`RowsTable` is now `RowsList`. One test in `comparar.test.ts` asserted the control had "its own
table cell"; it asserts the same rule as the card instead — the control is outside every anchor.

**The preview no longer asks for a password.** `PREVIEW_OPEN_AS` in `src/proxy.ts`: when it is
set, every request is forwarded as that one identity and nothing is asked. It is set only in the
Air's `.env`, and it is safe only because the Air is reachable over the tailnet and nowhere else.
Cloudflare Access still wins whenever `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are both
present, so this can never downgrade a real deployment — `src/proxy.test.ts` asserts it.

`vitest.config.ts` gained the `@` alias, without which no test can import a module that uses the
app's own import prefix.

## 4f. The app grew its own accounts — issue #166, merged 2026-09-12

The deployment depended on Cloudflare Access to say who anybody was. That made the family's front
door somebody else's product, and it made a real deployment wait on a Zero Trust account. The app
now owns its own accounts.

**PR #168 — accounts and a login.** `src/lib/accounts.ts` is the whole of it: scrypt hashing with
the salt carried in the stored string, `timingSafeEqual` on compare, an opaque 256-bit session id,
five tries then a minute locked, and a refusal that reads the same for an unknown address as for a
wrong clave — «El correo o la clave no son correctos.» — so the form cannot be asked, one address
at a time, who is in this family. Ten accounts is the ceiling in two places: a count that gives a
readable refusal, and a `BEFORE INSERT` trigger that is the one that cannot lose a race.

The session is a row, not a token. Next 16 runs `src/proxy.ts` on the **Node.js** runtime, so the
proxy can read the database; that single fact deleted a signed token, a signing secret, a second
verification, a `resets` table and a `SIGNUP` environment variable from the design. Deleting the
row ends the session on the next request, which is what makes «cerrar todas las sesiones» real.

`/invitacion/<token>` does three things, decided by who is reading it: sign up, set a new clave,
or join the project. One code path and one table, because there is no mail server to send a reset
to — the owner hands over a link exactly as they do for a new person.

**PR #169 — the first account takes over the server it finds.** The Air's control database held an
owner called `--reset` (a command-line flag written where an address belonged) and six
`@casa.local` members invented by the preview door. None of them could sign in, and the 23 flats
belonged to them. Signing up would have built a second, empty project beside the real one.
`adoptProjects()` deletes the rows that are not addresses and makes the first account owner of
every project on the server. It never demotes anybody.

**PR #171 — the front door says «proyecto».** «Empieza la casa» used the word two ways on the
first screen a person sees: a house is the product this app collects, and the container is a
search project. **PR #173** then gave `/entrar` and `/invitacion` one shell — the mark, a tagline,
and a card over three drifting shapes. `DESIGN.md` § *The front door* is the specification.

---

## 4g. The repository, the documents and a way to show it — 2026-09-15

No behaviour of the app changed in this session. Four things did.

**The documents say what is true — issue #174, PR #175.** `README.md`, `CLAUDE.md` and this file
still described a Cloudflare Access deployment of a code-complete, undeployed app. They now
describe the app's own login and the deployment behind it. The exact hostname is deliberately not
written in any tracked file; it is in `memory/`.

**The repository is clean.** 43 remote branches were deleted, each one proved first to be an
ancestor of `origin/main`. `origin` now holds `main` and nothing else. The names and their commit
ids are in `memory/deleted-branches-2026-09-12.txt`, with the command that restores any of them.
205 commits were searched for the operator's real name and for the Air's hostname: no hit.

**`.next.nosync` is ignored — PR #176.** iCloud does not sync a folder whose name ends `.nosync`,
so the build output here is `.next.nosync/` with `.next` a symlink to it, and git did not know
that name. The same rename also broke `pnpm lint`; § 9 has that trap.

**`./showcase.sh` — PR #177.** A way to show the app with no login. It writes `AUTH_DEV_EMAIL`
into `.env.local` and runs `next dev` bound to **127.0.0.1**, on port 3010. Two facts make the
script what it is:

- `AUTH_DEV_EMAIL` is read inside a `process.env.NODE_ENV === "development"` branch, which Next
  replaces at build time. The bypass is dead code in the production image and cannot reach a
  deployment.
- `next dev` binds to **every** interface by default. Measured before the script existed: a
  request from the local network to port 3010 answered **200** and served 23 real listings with
  their photographs and their notes, with no password. `-H 127.0.0.1` is the whole fix; the same
  request then answered nothing. `./showcase.sh --lan` opens it on purpose, prints what it is
  exposing, and waits four seconds first.

---

## 5. Not done

### Release A — nothing left

All seven packages are merged. PIP-05 and PIP-06 were the two that PIP-01 to PIP-03 had unblocked;
PIP-08 was independent of them.

### Release B — the opinion and the conversation are done

Merged: **PIP-09** (opinions, private drafts and withdrawal, #139), **PIP-10** (the editor #141,
and the person cards that read before the numbers #144), **PIP-11** (replies, editing, removal and
opinion references, #146). The fair family average that F21 named landed with them (#130): the
number is now the mean of each person's mean, not the mean of the rating rows.

PIP-07, PIP-13 and PIP-14 followed and are merged (#154, #152, #156). The last piece of PIP-10,
split out of #144, is **issue #161**: the comparison page compared flats and not opinions. It now
carries the four sections document 02 § 6 asks for — stances with a published-author count,
impediments by name, the reasoning of each person, and the six aspects — plus **Ver como**, which
turns every one of those rows into one person's. The fact rows never move with it.

Nothing of Release A or Release B is left.

### Deferred by the proposal itself

PIP-12 (visits and tasks) and PIP-15 (manual fact corrections). These need new evidence and
Kenobi's approval before anyone writes code. Do not pick them up.

### PIP-16

Not a package to build once. It is the proof step run for each release. **Run for Release B on
2026-09-10 (#158).** The evidence, and the eight things nobody has checked, are in
`docs/RELEASE-B-PROOF.md` — read § 5 of it before claiming anything is verified.

---

## 6. Blocked, and on whom

**One item. Only Kenobi can do it, and it is two minutes of work.**

| # | What | Where |
|---|---|---|
| — | **Make the first account** at `/entrar`, over the tailnet | the Air, port 8080 |

That account claims the server and adopts the 23 flats. Until it exists the DNS record stays
unpublished, because whoever makes the first account on a reachable host owns everything on it.

What used to be here is gone. **#1** (a domain on Cloudflare DNS) is done — the domain is bought,
the zone is on Cloudflare and the tunnel is healthy. **#2** (a Zero Trust account) is no longer a
blocker of anything: the app has its own login, and Access is an optional outer gate. **#18**
(Air setup) is done: `cloudflared` runs, the route is configured, and the `.env` is written.
**#5** (the member email list) is no longer a deployment step either — members arrive through
invitations from inside the app, so no list is needed anywhere in advance.

Behind the first account, in order: publish the DNS record → **#19** M1 integration → **#20**
phone checklists.

---

## 7. Open decisions for Kenobi

Each of these is small, and each one is his to make.

1. **Rotate the Cloudflare API token.** Investigated 2026-09-15: **there is no evidence of
   compromise.** The value is in exactly one file — this project's own session transcript on the
   Pro — and in nothing else: not shell history, not the working tree, not `git log --all -S`, not
   anywhere in the iCloud workspace. The account shows nothing unexpected: **zero DNS records** in
   the zone, and one tunnel, healthy, made on the day it was made. The audit log could not be
   read, because this token does not carry the permission to read it; the dashboard shows it.

   Rotation is therefore hygiene, not an incident: a transcript is resent as context on every
   turn, so the value left the machine in plaintext. **It has not been rotated** — the Keychain
   item `cloudflare-casa` is unchanged since 2026-09-12 10:15:25Z — and it **never expires**. A
   replacement needs three permissions, scoped to the one account and the one zone:
   Account · Cloudflare Tunnel · Edit, Zone · DNS · Edit, Zone · Zone · Read. The running tunnel
   uses its own credentials file, not this token, so rotating it breaks nothing.
2. **Enable HTTPS certificates on the tailnet?** One toggle at the Tailscale admin console,
   DNS → HTTPS Certificates. It turns the preview into a real `https://` address with a valid
   certificate. Two minutes of work after that. Less urgent now that the domain exists.
3. **Signed commits.** About half of this repository's history is unsigned. This is a private
   personal repository with one author, so nothing requires signing; it is worth a decision
   rather than an accident. Signing would use a personal key, never a work one.
4. **Issue #167** — the Jitsi/Netflix house link and profile boxes: one link, one clave, and a
   row of people to pick from, so a family member can use the project without an account of their
   own. Filed on his instruction, explicitly for later. It is not blocked; it is not started.

---

## 8. Known gaps and loose ends

These are real, and none of them is fixed.

- ~~**`docs/product-improvement/` is untracked.**~~ **Done.** The 16 packages, 40 findings, 12
  decisions and 27 validation cases are committed; nine files are tracked under that path.
- ~~**The family score is not fair yet.**~~ **Done (#130).** It is the mean of each person's
  mean. Since #161 the comparison page derives its number and its six aspect rows from the same
  helpers, so the two can no longer disagree.
- **Below 768 px is now partly seen.** Headless Chrome will not go under a 500 px layout
  viewport, but 500 px is under the 768 px breakpoint, so the phone branch of the comparison page
  was exercised for real on 2026-09-11: `wide` false, the pair selector present, and
  `scrollWidth === innerWidth` after the fix. **320 px is still unseen, and so is every real
  phone.**
- **No layout above 960 px has been seen in a browser.** The automation
  cannot change the layout viewport, so the desktop split view and every phone layout are covered
  by source assertions only. Where a phone branch mattered — the comparison pair view — it was
  exercised by pointing its media query at 4000 px temporarily, which proves the branch and not
  the breakpoint. **Do not claim any of it is visually verified.**
- ~~**No backup restore drill.**~~ **Done 2026-09-10 (#21).** The script and the LaunchAgent are
  installed on the Air, the agent has fired at exit status 0, and a restore was carried out: both
  files pass `integrity_check`, and every count matches the live database — 24 properties, 3
  opinions, 3 comments, 18 ratings, 57 events, 7 users. Photographs are still not backed up, on
  purpose; `air/README.md` says so where a restore would find it.
- **The map's group chooser has no real data behind it.** All 19 mappable properties have
  distinct coordinates. The chooser was verified by forcing three onto one point in a throwaway
  copy of the database. It is unit-tested, and it has never fired on real data.
- **`rateAction` still returns silently** on an empty submission. It is the one mutation without
  a result state; its form belongs to PIP-10.
- **Four of the 23 properties have no coordinates**, so they appear in the list and never on the
  map. The list now says how many, which is the fix — the behaviour itself is correct.
- **Seven accounts on the Air, six of them debris (#164).** Deploying #161 made it visible: the
  new **Ver como** selector lists every account in the project, and the same seven are the
  denominator of «Han opinado: 1 de 7 personas» everywhere. Only `familia@casa.local` — the
  `PREVIEW_OPEN_AS` identity — has written anything. `--reset` is the fossil of the argv bug fixed
  in #74 and owns all 23 imported properties, so it has to be renamed rather than deleted. The
  code is not wrong; the data is. **Kenobi's decision — they are his logins.**
- **Two defects only a browser found (#161).** A row keyed by its label alone made React
  reconcile the flat's «Estado» onto the family's score for «Estado», so «Solo diferencias» showed
  a row that did not differ; and libSQL rows were being handed straight to a client component,
  which React refused once per row — silently in production, loudly in development. Both are
  fixed and both have a source test. Neither was visible in 692 passing tests. **Open the page.**

---

## 9. Traps in this checkout

Two of these cost real time. Read them before you debug something that is not your bug.

- **A worktree needs its own `node_modules`.** Turbopack refuses a symlink that points outside
  the worktree (`Symlink [project]/node_modules is invalid`). Run `pnpm install` inside the
  worktree; it takes about three seconds and hard-links from the store.
- **iCloud can break the canonical checkout's `node_modules` symlink.** It happened on
  2026-09-08. What iCloud actually did: it kept the symlink but renamed it `node_modules 2`,
  and put an empty real directory in its place. So `node_modules.nosync/` was intact at 558 MB,
  the symlink still existed under another name, and every command failed with
  `no such file or directory: ./node_modules/.bin/vitest`.

  The fix, in this order:

  ```sh
  ps -o %cpu= -p $(pgrep -x bird)      # ~0.0 first, or iCloud rebuilds it under you
  rm -rf node_modules                  # ~4 minutes, for an empty directory
  rm "node_modules 2"                  # the renamed symlink
  ln -s node_modules.nosync node_modules
  ```

  While the `rm` runs, even `find` on that directory hangs. `.gitignore` now also matches
  `node_modules 2`, so a collision rename can never be committed by accident.
- **A worktree is not a faithful copy.** It sits on an ASCII path outside iCloud; the real
  checkout does not. PR #69 exists because of exactly that difference. Run the checks in the
  canonical checkout before you call a branch green — **except the build, which no longer runs
  there.** See the next trap.
- **`next build` panics wherever `node_modules` is a symlink.** Measured 2026-09-11:

  ```
  internal error: entered unreachable code: there must be a path to a root
  turbopack/crates/turbopack-core/src/module_graph/mod.rs:746:25
  ```

  Turbopack panics inside `ModuleGraphImportTracer::get_traces` — while trying to attribute an
  issue it wants to report — so the issue itself is never printed and 90 workers panic at once.

  **The cause is the symlink, not iCloud and not the code.** Isolated by changing one thing in an
  ASCII worktree outside iCloud, on the same commit: a real `node_modules` directory builds clean,
  and `node_modules → node_modules.nosync` panics 90 times. `main` at `0f7cefb` behaves the same
  way, so no branch introduced it.

  That symlink is the workspace-wide `.nosync` convention (workspace `CLAUDE.md`, "Sync
  architecture"), which keeps 705 MB of dependencies out of iCloud. It applies to 16 targets, so
  this is likely to bite other Next projects here, not only this one.

  What it does and does not break:

  | | With the symlink |
  |---|---|
  | `vitest`, `eslint` | work |
  | `next dev` | works |
  | `next build`, and `tsc --noEmit` (it needs the `.next/types` the build writes) | **panic** |
  | `./deploy.sh` | **unaffected** — `.dockerignore` excludes `node_modules*`, so the image runs its own `pnpm install` and gets a real directory. Verified 2026-09-11: `docker build --platform linux/arm64` exits 0 with no panic. |

  So: run `vitest` and `eslint` in the canonical checkout; run `next build` and `tsc` in a
  worktree, where `pnpm install` makes a real directory. Deployment needs no workaround.
- **`pnpm lint` reported 552 errors that were not yours.** Same cause, other end: the build output
  here is `.next.nosync/` with `.next` a symlink to it, and `eslint.config.mjs` ignored `.next/**`
  only, so eslint walked into generated code. CI never saw it, because CI lints before it builds.
  Fixed 2026-09-15 — the config ignores `.next.nosync/**` as well. If a lint run ever names a file
  you did not write, look at what the ignore list does **not** cover on a `.nosync` Mac.

---

## 10. How to pick up the next piece of work

1. Read `CLAUDE.md`, `DESIGN.md`, this file, and `WORKPLAN.md` § 4 (the agent contract). Then
   `memory/identity.md` and the tail of `memory/journal.md` — they are gitignored, they hold the
   hostname, the domain and the Keychain item, and they are where the last session says what it
   left. `memory/decisions.md` holds why the app has its own login and why the DNS record is not
   published.
2. Take the next eligible package from § 5 above. **There is none left**: every package of
   Release A and Release B is merged, and PIP-12 and PIP-15 are deferred by the proposal itself.
   What is open is in § 6, and all of it is Kenobi's or needs a real phone.
3. Open a GitHub issue for it. Do not invent issue numbers.
4. Branch `issue-<n>-<slug>` in a worktree outside iCloud, then `pnpm install` inside it.
5. Implement only that package. Add tests that fail if the behaviour breaks.
6. Run the checks **in the canonical checkout** before opening the pull request.
7. Record what you did not verify. Do not mark a visual check passed from reading source.
8. Close the session by appending a dated entry to `memory/journal.md`.

To **show** the app rather than work on it: `./showcase.sh` serves it with no login at
http://127.0.0.1:3010, on this Mac only.
