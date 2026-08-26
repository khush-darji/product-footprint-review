# Product Footprint Review

Internal tool for reviewing supplier-reported carbon footprints before they're used in
reporting: browse the queue, filter and sort it, inspect a submission, approve or reject
it with a comment, and share it with colleagues as a viewer or an editor.

**Sign in with `r.osei@example.com` / `Password123!`** to try it — the full list of demo
accounts is in [Access control](#access-control) and in the sign-in panel itself.

The fixture data covers the kinds of value-chain emissions this tool reviews — battery
systems, raw materials, electronic components, grid infrastructure, vehicle parts,
packaging and logistics.

Submissions over the risk thresholds (≥ 500 kg CO2e per unit, or ≥ 25% uncertainty) are
flagged as **hotspots**: the large or least certain figures in a value chain, and the
ones worth a reviewer's attention before they reach a disclosure.

> **The seed data is invented.** Every emissions figure, supplier name and note in
> `backend/src/db/seeds/footprint.seed.ts` is fictional demo data — not a real
> disclosure and not a real supplier.

The project is split into a **Next.js frontend** and an **Express + TypeScript backend**
backed by **PostgreSQL via TypeORM**. The two talk over a versioned REST API and are
developed, built and deployed independently.

```
product-footprint-review/
├── backend/            Express + TypeScript REST API (TypeORM, PostgreSQL)
│   ├── src/
│   │   ├── __tests__/      Jest + supertest, against a real database
│   │   ├── config/         env schema, validated at boot
│   │   ├── db/             DataSource, migrations, seeds
│   │   ├── domain/         framework-free rules — access.ts holds the whole model
│   │   ├── entities/       TypeORM entities
│   │   ├── schemas/        Zod request schemas (the boundary contract)
│   │   ├── repositories/   the only place queries live
│   │   ├── services/       business logic, no HTTP
│   │   ├── routes/         parse, call a service, respond
│   │   ├── mappers/        entity -> API response
│   │   ├── middleware/     request id, auth, validation, errors
│   │   ├── lib/            logger, errors, pagination
│   │   ├── app.ts          Express wiring (no listen)
│   │   └── server.ts       boot + graceful shutdown
│   └── Dockerfile
├── frontend/           Next.js 16 App Router UI
│   ├── app/                pages
│   ├── components/         presentational components
│   ├── components/         AccountPanel is the sign-in / sign-out sidebar
│   ├── lib/                API client, session context, response types
│   └── Dockerfile
└── docker-compose.yml  postgres + backend + frontend
```

**Reviewing this?** [Running it](#running-it) · [Completed scope](#completed-scope) ·
[Trade-offs](#trade-offs) · [Future improvements](#future-improvements) ·
[Known gaps](#known-gaps) · [AI usage](#ai-usage)

## Running it

**From a fresh checkout, yes — both paths below start at `git clone` with nothing else
prepared.** The Docker path needs only Docker and takes no configuration at all: every
variable has a working default in `docker-compose.yml`. The local path needs Node 20.9+
(Next 16's floor) and Docker for Postgres, and the two `cp .env.example` lines are the
whole setup — no value in either file has to be edited to run locally. Both `.env` files
are gitignored, which is why they are copied rather than shipped.

### Everything in Docker (nothing else required)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:4000
- Postgres: localhost:5432

Migrations run automatically on backend startup. To load the eighteen fixture
submissions:

```bash
docker compose exec -e NODE_ENV=development backend node dist/db/seeds/run-seed.js
```

The `NODE_ENV` override is required and deliberate: the container runs as `production`,
and `seedUsers` refuses to run there because the demo passwords are public fixtures.
Overriding it is an explicit "yes, I know these are demo credentials".

The seed is idempotent — it does nothing if the queue already has rows. Append `--force`
to wipe and reseed. It prints the login credentials when it finishes.

The password the demo accounts get comes from `SEED_PASSWORD` in the environment
(`backend/.env` locally, the `backend` service's environment in Docker), not from source.
It has no fallback: seeding without it set stops with a message saying so.

### Locally (Node 20+, Postgres in Docker)

```bash
# 1. Database only
docker compose up -d postgres

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run migration:run
npm run seed
npm run dev            # http://localhost:4000

# 3. Frontend, in a second terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

Two checks that it came up correctly, before opening the browser:

```bash
curl -s localhost:4000/readyz     # {"status":"ok","database":"up"} — 503 means no database
curl -s localhost:4000/api/v1/footprints   # 401: the queue needs a session, as it should
```

Then open http://localhost:3000 and sign in with the credentials the seed printed. If the
queue is empty, the seed did not run — it skips silently when the table already has rows,
so use `npm run seed -- --force`.

## API

Base URL `http://localhost:4000`, versioned under `/api/v1`.

Every `/api/v1` endpoint except the index and `/auth/*` requires a valid session
cookie, set by `POST /api/v1/auth/login`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness — no dependencies touched |
| GET | `/readyz` | Readiness — checks the database, 503 when down |
| POST | `/api/v1/auth/login` | Sign in; sets the session cookie |
| POST | `/api/v1/auth/logout` | Sign out; deletes the session |
| GET | `/api/v1/auth/me` | The signed-in user |
| GET | `/api/v1/users` | Directory for the share picker |
| GET | `/api/v1/footprints` | List the queue (filter, search, paginate) |
| POST | `/api/v1/footprints` | Record a new submission → 201 |
| GET | `/api/v1/footprints/stats` | Counts by status + hotspot count |
| GET | `/api/v1/footprints/:id` | One submission |
| PATCH | `/api/v1/footprints/:id` | Correct a submission that is still pending |
| DELETE | `/api/v1/footprints/:id` | Delete → 204, cascades to the review timeline |
| POST | `/api/v1/footprints/:id/review` | Approve or reject |
| POST | `/api/v1/footprints/bulk-review` | Approve or reject up to 100 at once |
| GET | `/api/v1/footprints/:id/reviews` | The submission's decision timeline |
| GET | `/api/v1/footprints/:id/shares` | Who it is shared with (owner only) |
| POST | `/api/v1/footprints/:id/shares` | Grant or change access (owner only) |
| DELETE | `/api/v1/footprints/:id/shares/:userId` | Revoke access (owner only) |

**List query params:** `status` (`pending`/`approved`/`rejected`/`all`), `q` (searches
product and supplier), `scope` (`all`/`owned`/`shared`), `category`, `supplier`,
`highRiskOnly`, `sort` (`submittedAt`/`emissionsValue`/`uncertaintyPercent`), `order`
(`asc`/`desc`), `limit` (1–100, default 25), `cursor`.

**Bulk review** takes `{ ids, decision, comment }` — one decision and one comment applied
to every id — and answers `200` with `{ succeeded, failed }`. It is deliberately not
all-or-nothing: each submission is decided under its own row lock, and one that somebody
else decided first (or that the caller may only view) is reported in `failed` with the
same error `code` the single-submission endpoint would have returned, rather than
discarding the decisions that did succeed. Only a request that is wrong as a whole — a
bad `decision`, a non-UUID id, more than 100 ids — is a `400`.


Errors all use one envelope, and the `requestId` matches the `x-request-id` response
header and the server log line:

```json
{ "error": { "code": "conflict", "message": "...", "requestId": "..." } }
```

`400` invalid input · `401` not signed in or session expired · `403` your role does not allow it ·
`404` unknown submission *or* one you have no access to · `409` already reviewed / no
longer editable · `413` body too large · `429` rate limited · `500` server fault.

## Access control

Each submission has exactly one **owner** — the user who created it. The owner can share
it with other users as a **viewer** or an **editor**. Nobody else can see it at all.

| Capability | Owner | Editor | Viewer | No access |
|---|---|---|---|---|
| View the submission | yes | yes | yes | no (404) |
| View review history | yes | yes | yes | no (404) |
| Approve / reject | yes | yes | **no** | no |
| Edit while pending | yes | yes | **no** | no |
| Share / change a role | yes | **no** | **no** | no |
| Revoke access | yes | **no** | **no** | no |
| Delete | yes | **no** | **no** | no |

Sharing is owner-only on purpose: an editor who could re-share would be able to widen
access beyond what the owner granted, and "share with one colleague" quietly becomes
"share with the department".

**The data path is what enforces this, not the UI.** Three rules make that true:

1. **Reads are scoped, never filtered.** Every read goes through one query builder in
   `footprint.repository.ts` that joins the caller's grants and constrains the WHERE
   clause. There is no function that loads a submission without a user id, so there is
   no code path that fetches a row and then decides whether to hide it — the row never
   leaves the database. This covers the list, the detail view, the timeline, the stats
   counts and the review write.
2. **No access is a 404, not a 403.** A 403 would confirm the submission exists, which
   is itself something the caller was not granted. A 403 is only ever returned to
   someone who can already see the record, for an action their role does not permit.
3. **The actor comes from the session, never the body.** `requireAuth` resolves the user;
   services take that user as an argument. `ownerId` and `reviewedBy` are set from it,
   so a client cannot create a submission owned by someone else or attribute a decision
   to a colleague.

The UI reflects the model — a viewer sees no approve button and no sharing panel —
but that is presentation only. Forcing the controls back on in the browser and posting
directly still gets a 403; there is a test for exactly that, and it is demonstrated in
the verification table below.

### Authentication

Sign in with **email and password** on the sign-in screen. Once signed in, the left
sidebar shows who you are and holds **Sign out**. There is no user switcher: identity
comes from a session the server issued, and the only way to become someone else is to
sign out and sign in as them.

#### Demo credentials

Every seeded account uses the same password, so the access model can be seen from four
angles without hunting for four passwords. The table shows the fixture value shipped in
`.env.example`; the actual password is whatever `SEED_PASSWORD` held when the seed ran:

| Email | Password | What they see |
|---|---|---|
| `r.osei@example.com` | `Password123!` | Owns 6, editor on 1 — **7 visible** |
| `t.adeyemi@example.com` | `Password123!` | Owns 7, editor on 2 — **9 visible** |
| `m.lindqvist@example.com` | `Password123!` | Owns 5, viewer on 1 — **6 visible** |
| `j.park@example.com` | `Password123!` | **Owns nothing**, viewer on 3 — 3 visible, no review controls |

Sign in as **J. Park** to see the model working: the queue shrinks to three rows, every
badge says Viewer, the approve/reject buttons are gone, and there is no sharing panel.
Forcing those controls back on in the browser still gets a 403 — the UI reflects the
rules, it does not enforce them.

**These credentials are only here.** They are deliberately not printed anywhere in the
UI — a demo account list rendered on a page ships with the page. `npm run seed` also
prints them to the terminal when it finishes.

#### How it works

- **Passwords** are hashed with **argon2id**. A password is a low-entropy, human-chosen
  secret, so the hash's job is to be slow and memory-hard enough that offline guessing is
  expensive. The plaintext is never stored.
- **Sessions are server-side rows**, not JWTs, for one reason that matters here: they
  **revoke instantly**. Signing out deletes the row and the next request fails, where a
  self-contained JWT would stay valid until it expired regardless. Given the whole point
  of the app is controlling who sees what, that is worth a database round trip.
- **The session token lives in an httpOnly cookie**, so page JavaScript cannot read it
  and an XSS bug cannot walk off with a live session. It is never accepted from a header
  or query string — an alternative path would undo that. Only the SHA-256 digest is
  stored (a fast hash is correct for a 256-bit random token, and wrong for a password).
- **`SameSite=Lax`** is the CSRF defence: the browser will not attach the cookie to a
  cross-site POST. This works locally because :3000 and :4000 are the same site. **Split
  across real domains it must become `SameSite=None; Secure`, and then a CSRF token is
  required as well** — set `COOKIE_SAME_SITE` accordingly.
- **Login failures are indistinguishable.** An unknown address and a wrong password
  produce the same message, the same status, and roughly the same timing — the unknown
  path still runs an argon2 verify against a dummy hash. Different responses would be an
  account-enumeration oracle. Login also has its own tight rate limit, counting only
  failed attempts.

> **The seed passwords are public fixtures.** `seedUsers` refuses to run when
> `NODE_ENV=production`. A real deployment would issue credentials at registration or
> invite, never ship them in source, and would add password reset, rotation and expiry —
> none of which exist here.

## Interface

Two states, and nothing in between. **Signed out** is a centred sign-in card with no
sidebar and no navigation — an empty nav around a login form implies there is something
behind it, and there is not. **Signed in** is a left sidebar (identity, sign out) beside
the queue.

Design decisions worth noting, several of them from running the UI/UX skill's checklist
against the existing markup:

- **SVG icons, never emoji.** The previous `⚠` and `←` rendered differently on every
  platform, could not inherit `currentColor`, and were announced by screen readers as
  whatever the vendor happened to name them. `components/icons.tsx` holds eight
  hand-drawn 24×24 glyphs — not a dependency, for eight icons.
- **Status is carried by three signals**: an icon shape, a word, and a colour. Colour
  alone is invisible to a colour-blind user and to a screen reader.
- **Tabular figures** in the emissions and uncertainty columns, so digits line up down
  the column instead of jittering as values change width.
- **Fixed column widths.** Left to itself the browser gave the product column the least
  room and wrapped names over four lines, while "Uncertainty" kept a full column for
  "±9%".
- **`prefers-reduced-motion` is respected** globally — the motion here is decorative, so
  removing it costs nothing and large motion is genuinely unpleasant for some people.
- **Fira Sans / Fira Code**, self-hosted via `next/font` so there is no render-blocking
  request to Google and no third party learning who visits.

## How the backend is put together

**Layering.** Routes parse and respond, services decide, repositories talk to the
database. Services take plain arguments and return plain data, so the rules are testable
without HTTP, and every query for a table lives in one file rather than being copied
between handlers.

**Validation at the boundary.** Every body, query and param goes through a Zod schema,
and request types are inferred from the schemas rather than written beside them. Every
string is length-bounded and every number has a range. Parsed values are put on
`res.locals`, not written back over `req.body`, so a handler that reads the raw input by
mistake is visible in the types.

**Mass assignment is prevented by omission.** The update schema does not offer `status`,
`reviewedBy` or `reviewedAt` at all, so there is no path by which a client can approve a
submission through the update endpoint. Zod strips unknown keys, so extra fields in a
create request are discarded rather than persisted.

**Concurrent reviews cannot both win.** Recording a decision happens in a transaction
that takes a row lock (`SELECT ... FOR UPDATE`) before checking that the submission is
still pending. Checking first and writing afterwards is the read-modify-write race that
would let two reviewers both approve the same submission. Verified: eight simultaneous
approvals of one submission produce one `200`, seven `409`s, and exactly one timeline
entry.

**Pagination is keyset, not offset.** The cursor encodes `(submittedAt, id)` and the
query uses a row-value comparison matching the index order. Offset pagination would
reuse and skip rows as new submissions arrive underneath a reviewer paging through the
queue.

**Errors are typed and mapped once.** Services throw `NotFoundError`, `ConflictError`
and friends; one error handler turns them into status codes. Anything unrecognised is
logged in full and returned as a generic 500 — driver messages name tables and columns,
which is how an attacker maps a schema.

**Operations.** Structured JSON logs (pino) with a request id on every line and
credentials redacted; liveness and readiness split so a database blip cannot get healthy
processes killed; SIGTERM drains in-flight requests before closing the pool, with a
forced-exit timer so a stuck connection cannot hang a deploy.

**Optimistic review, with a real rollback.** Approve/reject applies to local state
immediately — status badge, the form disappearing, a provisional timeline entry marked
"saving…" — then reconciles with the server's response. On failure the *entire* previous
state is restored from a snapshot rather than patched back field by field, so a partial
rollback cannot leave the page showing a decision that never happened. The case worth
getting right is a 409: someone else decided first, so rolling back to "pending" would
also be wrong, and it refetches instead.

**Accessibility.** Semantic controls throughout — real `<button>`s, labels tied to every
input, `<th scope>` on both axes of the table, a `<caption>`, and a skip link. The status
filters use `aria-pressed` on a labelled group rather than `role="tablist"`, because they
filter one list rather than switching panels, and claiming tab semantics would promise
arrow-key navigation that does not exist. Status is never carried by colour alone. Live
regions announce the optimistic status change, the row count after "Load more", and the
identity switch. Verified with axe-core at WCAG 2.1 AA: **0 violations**.

**Hotspot detection lives in one place.** `isHighRisk` is computed server-side from the
domain thresholds and returned on every submission, and the same thresholds drive the
`highRiskOnly` SQL filter. The UI renders the badge but never recomputes it, so the flag
and the filter cannot disagree. (The API field is named for the review property it
measures; the UI labels it "hotspot", which is the business's word for the same thing.)

## Database

Two tables. `product_footprints` holds the submission plus the most recent decision
denormalised onto the row (so the list view needs no join); `review_events` is an
append-only timeline of every decision ever recorded, which is what the detail page's
"Review history" section shows.

Emissions and uncertainty are `numeric`, not float — these numbers end up in reporting —
with a transformer converting the driver's string back to a number. Check constraints
enforce non-negative emissions, uncertainty within 0–100, and that a reviewed row always
has both a reviewer and a timestamp.

Schema changes are committed migrations; `synchronize` is off everywhere.

```bash
npm run migration:generate -- src/db/migrations/AddSomething   # from entity changes
npm run migration:run
npm run migration:revert
npm run migration:show
npm run schema:log        # drift check: entities vs. live schema
```

The initial migration was generated from the entities and then edited for two things the
generator cannot know about — enabling the `uuid-ossp` extension that
`uuid_generate_v4()` needs (without it the first `CREATE TABLE` fails), and adding
trigram GIN indexes so the `ILIKE` search is an index scan rather than a sequential one.
It has been verified to run, revert to a clean schema, and re-run.

## Testing

```bash
cd backend
docker compose -f ../docker-compose.yml up -d postgres   # tests need a real database
npm test
```

**75 tests across 5 suites**, run against a real Postgres — not mocks. That is a
deliberate choice: the risk here is concentrated in the access-scoped SQL and the
row-locked review transaction, and neither survives being mocked. A stubbed repository
would happily "prove" a viewer cannot approve while the actual WHERE clause leaked every
row.

The suite creates a scratch database (`footprint_review_test`), runs the **real
migrations** against it, and truncates between tests. Running the migrations rather than
`synchronize: true` means a broken migration fails the tests instead of passing against
a schema nobody will ever deploy.

| Suite | Covers |
|---|---|
| `auth.test.ts` | login success/failure, enumeration resistance, argon2 storage, sign-out revocation, session expiry, isolation |
| `access-control.test.ts` | auth rejection, list scoping, IDOR on every endpoint, role capabilities, mass assignment |
| `sharing.test.ts` | grant / upgrade / revoke, who may manage sharing, cascade on delete |
| `review-flow.test.ts` | validation messages, 409 conflicts, the timeline, 8 concurrent approvals |
| `pagination.test.ts` | cursor round-trip and rejection, full keyset walk, sorting, sort allowlist, risk thresholds |

The ones worth reading first are the IDOR tests (a stranger gets an identical 404 for
"exists but not yours" and "does not exist"), the concurrency test — eight simultaneous
approvals produce exactly one 200, seven 409s, and one timeline row — and the sign-out
test, which asserts the *data path* closes rather than just the identity endpoint.

## Verification

Everything below was run against a real Postgres and a real browser.

| Check | Result |
|---|---|
| `npm test` (backend) | 75 passed, 5 suites |
| `npx tsc --noEmit` (backend, frontend) | passes |
| `npm run lint` (backend, frontend) | passes |
| `npm run build` (backend, frontend) | passes |
| `npm audit` (backend, frontend) | 0 vulnerabilities |
| Migrations run → revert → re-run | clean round trip, rows intact |
| `AddUsersAndSharing` against a populated table | 18 rows backfilled, `owner_id` `NOT NULL`, revert kept data |
| `AddPasswordAuthAndSessions` against populated users | column swapped, revert restored, trigram indexes untouched |
| Login with correct / wrong / unknown credentials | 200 with httpOnly cookie / identical 401 / identical 401 |
| `document.cookie` in the browser | empty — the session is invisible to page JavaScript |
| Session survives a page reload | yes (cookie), and no token is stored client-side |
| Sign out | 204, then 401 on `/auth/me` **and** on the data endpoints |
| Per-user visibility (4 seeded users) | 7 / 9 / 6 / 3 rows — J. Park owns nothing, sees only their 3 grants |
| IDOR: stranger reads another user's submission | 404 on detail, timeline, shares **and** review |
| Viewer attempts approve / edit / share / delete | 403 on each |
| Editor attempts share / delete | 403 on each |
| Share → upgrade role → revoke | access appears, changes, and disappears; one grant row, never two |
| Viewer bypassing the UI with a direct `fetch` | 403 from the server |
| Token hash in any API response | never present (`select: false` + explicit mapper) |
| Sort by emissions / uncertainty, asc and desc | correct order |
| Keyset walk under a non-default sort | 9 rows, no duplicates, monotonic |
| Cursor reused across a different sort | 400 with an explanation |
| `?sort=` injection attempt | 400, rejected by the allowlist |
| Optimistic approve (response delayed 2.5s) | status flips immediately, shows "saving…", reconciles on confirm |
| Optimistic rollback (forced 500) | full prior state restored, provisional timeline entry removed, error shown |
| axe-core WCAG 2.1 AA audit | **0 violations** on sign-in, queue and detail |
| Horizontal page scroll at 375 / 768 / 1024 / 1440 | 0px at every width (table scrolls inside its own box) |
| Contrast sweep for `text-slate-400` body text | none left; remaining uses are placeholders, borders, a spinner |
| Keyboard tab order | skip link → sign-in fields → submit; signed in, sidebar → filters → rows |
| `docker compose up` full stack | all services healthy, browser flow works |
| SIGTERM | drains and exits cleanly in ~7ms |

## Completed scope

What was finished inside the four-hour timebox. Everything listed here is built, wired end
to end, and covered by the verification table above — nothing in this section is a stub or
a screenshot.

**The whole review journey works.** Sign in → the queue (filter by status, search product
and supplier, filter by category, supplier and hotspot, sort by date, emissions or
uncertainty, page through with a cursor) → a submission's detail page → approve or reject
with a comment → the decision appears in an append-only timeline → share the submission
with a colleague as a viewer or an editor, change their role, revoke it. Submissions can
also be created, corrected while pending, and deleted.

- **Backend** — Express 5 + TypeScript over PostgreSQL via TypeORM: 15 endpoints,
  routes/services/repositories layering, Zod validation on every body, query and param,
  typed errors mapped once to status codes, structured pino logs with a request id,
  read/write/login rate limits, helmet and an explicit CORS allowlist, split liveness and
  readiness, and a SIGTERM drain.
- **Data** — three committed migrations (initial schema, users and sharing, password auth
  and sessions), each verified to run, revert and re-run against populated tables.
  `numeric` columns and check constraints for figures that end up in reporting. Trigram
  GIN indexes so the search is an index scan.
- **Auth** — email/password with argon2id, server-side sessions in an httpOnly cookie
  (only the SHA-256 digest is stored), enumeration-resistant login, instant revocation on
  sign-out, 7-day expiry with opportunistic purging of expired rows.
- **Access control** — owner / editor / viewer, enforced in the SQL rather than the UI,
  with "no access" answered as a 404 so the API does not confirm what it will not show.
- **Frontend** — Next.js 16 App Router: sign-in screen, queue, detail view, share panel,
  optimistic approve/reject with a full-snapshot rollback and a refetch on 409. WCAG 2.1
  AA verified with axe-core (0 violations) and no horizontal scroll from 375px up.
- **Tests** — 75 backend tests across 5 suites against a real Postgres, including IDOR on
  every endpoint, the viewer/editor capability matrix, eight concurrent approvals, and a
  full keyset pagination walk.
- **Packaging** — `docker compose up --build` brings up Postgres, API and UI; a seed loads
  eighteen fictional submissions across four users with sharing already set up.

## Trade-offs

What was deliberately kept simple, and why:

- **Two tables, not a normalised model.** No supplier, product, category or organisation
  tables — a submission carries those as columns, and the latest decision is denormalised
  onto the row so the queue needs no join. The journey being reviewed is *review this
  figure*, and a supplier table with one column would have been schema for its own sake.
- **Server-side sessions over JWTs.** Stateless tokens would avoid a database round trip
  per request; they cannot be revoked before they expire. For an app whose entire subject
  is who may see what, instant revocation was worth more than the round trip.
- **`SameSite=Lax` as the entire CSRF story.** Correct while the UI and API share a site,
  which they do on localhost and in the compose stack. A token-based defence is real work
  and only becomes necessary in a split-domain deployment, so it is documented rather than
  written.
- **Tests hit a real database instead of mocks.** They need Docker and run in ~4s rather
  than instantly, and that is the point: the risk lives in the access-scoped WHERE clause
  and the row lock, and a mocked repository would pass while leaking every row.
- **No frontend test framework.** The React side was verified by driving a real browser,
  which was the fastest way to cover the optimistic-update and accessibility work in the
  time available. It is the largest thing not repeatable in CI.
- **Rate limiting is in-process memory.** `express-rate-limit`'s default store is correct
  for one instance and wrong behind two — a shared store is a deployment concern, not a
  design one.
- **Eight hand-drawn SVG icons instead of an icon library**, and no state-management
  library: React context plus a small fetch client covers a two-screen app.
- **One shared demo password** across the four seeded accounts, read from `SEED_PASSWORD`
  rather than hardcoded. Four passwords would be friction with no security benefit for
  fixtures that refuse to run in production.

## Future improvements

Roughly in the order they would matter before this served real disclosures:

1. **Close the auth gaps.** Registration or invite, password reset and change, lockout
   after repeated failures, and MFA for a tool that gates reporting data. Per-account
   login limits alongside the per-IP one.
2. **CSRF tokens**, needed the moment the UI and API stop sharing a site — together with
   `COOKIE_SAME_SITE=none` and HTTPS everywhere.
3. **CI.** There is no pipeline in the repo; lint, typecheck, `npm test`, `npm audit` and
   a migration round-trip on every PR is an afternoon's work and stops all of the above
   silently rotting.
4. **Playwright specs** for the review flow, the viewer/editor split and the optimistic
   rollback, replacing the manual browser verification with something CI can run.
5. **Organisation scoping.** `GET /users` returning every user is only acceptable while
   every user is a colleague; a tenant boundary is a schema change, so it is the sort of
   thing worth doing before there is data to migrate.
6. **Audit trail for access changes.** Decisions are recorded; grants and revocations are
   not. Ownership transfer, too, so deleting a user stops destroying submissions other
   people can see.
7. **Observability beyond logs** — metrics, tracing and error tracking, plus shipping the
   pino output somewhere queryable.
8. **Operational hardening** — a shared rate-limit and session store, migrations run as a
   deploy step rather than on boot (`RUN_MIGRATIONS_ON_BOOT=false`), and secrets from a
   manager instead of a `.env` file.

## Known gaps

- **Authentication is real but minimal, and the demo passwords are public.** There is no
  registration, password reset, password-change, rotation, lockout after repeated
  failures, or multi-factor. Sessions have a fixed 7-day expiry with no sliding renewal
  and no "sign out everywhere". The seed refuses to run under `NODE_ENV=production`, but
  nothing stops someone pointing this at a real database with a different seed.
- **CSRF rests entirely on `SameSite=Lax`.** That is sufficient while the frontend and
  API share a site, as they do locally. Split across domains, `COOKIE_SAME_SITE=none`
  becomes necessary and a CSRF token has to come with it — there is none today.
- **Login is rate-limited by IP only.** A per-account limit keyed on the submitted email
  would also be worth having, to stop one account being sprayed from many addresses.
- **`GET /users` returns every user to any authenticated caller.** Fine for an internal
  tool where everyone is a colleague; in a multi-tenant product it would have to be
  scoped to the caller's organisation. There is no organisation concept here at all.
- **No audit log.** `review_events` records who decided what and when, but grants and
  revocations leave no history — you can see who *has* access, not who removed whom.
- **No test for the frontend.** The backend has 75; the React side was verified by
  driving a real browser (see the verification table) but none of that is repeatable in
  CI. Playwright specs for the review flow and the viewer/editor split are the obvious
  next addition.
- **No CI pipeline.** Everything in the verification table was run locally. Nothing in
  the repo re-runs it on a push, so the table is a record of one moment rather than a
  standing guarantee.
- **The rate limiter counts in process memory.** Two instances behind a load balancer
  would each allow the full budget, and a restart forgets every counter. A shared store
  is the fix; there is no reason to add one for a single container.
- **The trigram indexes are invisible to TypeORM.** It has no metadata for operator
  classes, so `npm run schema:log` reports the two of them as drift, and
  `migration:generate` will emit statements dropping them and recreating them *without*
  `gin_trgm_ops` — which would silently make the search sequential again. **Delete those
  two index statements from any generated migration.** This already happened once while
  building `AddUsersAndSharing`; the migration's header comment records it.
- **Optimistic review is single-flight.** The buttons disable while a decision is in
  flight, so there is no queue of pending mutations to reconcile. A richer version would
  need real request coalescing.
- **Deleting a user cascades to their submissions.** `ON DELETE CASCADE` on `owner_id`
  means removing an account destroys everything they submitted, including submissions
  shared with other people. Transferring ownership first would be the safer behaviour.

## AI usage

**Claude Code wrote some of the code here.** A few of the prompts, and what each one
produced:

- *"Build the review list API from this spec — the journey, the data model, the validation
  rules"* → the routes/services/repositories layering, the schemas, the TypeORM
  entities and the first migration.
- *"Test it against a real Postgres, not mocks. Cover every endpoint and two
  people approving at once"* → the five suites, including the eight-way concurrency test
  that is the reason the review transition takes a row lock.

The architectural calls and most of the coding were completed by me: sessions over JWTs, 404 rather than 403 for records you
cannot see, scoping reads in SQL instead of filtering after the fetch, and the row lock.
The reasoning sits in a comment at each of those points rather than in this file.
