# GEO — Multi-tenancy, accounts and onboarding

> Scoping document. Written after a line-by-line audit of the codebase and a
> verification pass over the auth libraries against the versions this repo
> actually pins. Nothing here is built. Section 3 lists the decisions that must
> be settled first, because everything later depends on them.

---

## 0. The prerequisite nobody can design around

**The box serves plain HTTP on a bare IP.** `BUILD_PLAN.md:43` chose this
deliberately for a one-day build. It blocks every authentication option equally:

- A session cookie cannot carry `Secure`, so it crosses the network in cleartext.
- A magic link emailed as `http://5.78.222.163/geo/...` is both a token leak and
  a spam-filter magnet.
- Clerk, Auth0 and WorkOS all require an HTTPS redirect URI for anything that is
  not localhost.

**Get a domain and a Let's Encrypt certificate on nginx before any auth work
starts.** This is step zero, not a hardening task for later. It is also cheap:
one DNS record and certbot.

Until then, the stopgap below is what stands between the demo and the internet.

**Stopgap in place (2026-09-13).** HTTP basic auth was added to the nginx
`location ^~ /geo` block (user `geo`, credentials held by the team, file
`/etc/nginx/.htpasswd-geo`, config backed up beside
`/etc/nginx/sites-available/cape-fear-staging`). Everything under `/geo` now
returns 401 without credentials. Before it, a request from the public internet to
`/geo/api/answers/1` returned a full answer record, and `POST /geo/api/trigger` —
which queues roughly $11 of model calls — accepted anonymous requests. This is a
door lock on a demo box: one shared password, no users, no organizations, sent in
cleartext. It must be removed the day real auth ships, and it must not quietly
become the security model.

---

## 1. Where we are today

**Tenancy is implied by a single row.** The product's notion of "you" is
`brands.is_self = 1`, resolved at `src/lib/metrics.ts:137` with
`SELECT name FROM brands WHERE is_self = 1 LIMIT 1`. There are no
`organizations`, `users`, `memberships` or session tables. Seven tables exist and
none has an owner column. The only identity-shaped field in the schema is
`run_requests.requested_by TEXT`, hardcoded to `'dashboard'` at
`src/app/api/trigger/route.ts:28`.

**The company profile lives in source.** `src/lib/config.ts` holds the tracked
brand and domain, the sales-context blurb fed to every LLM prompt, the 10-brand
competitor set and the 15 tracked questions. `PROJECT` is referenced 15 times
across the integrations, the layout and the sidebar. Changing customer means
editing TypeScript and redeploying. Three seeded questions name Lemma literally.

**Every dashboard page is a client component** reading through
`src/app/_lib/fetcher.ts` against seven route handlers. No server component does
data access. That is the single most useful structural fact here: **the entire
tenant-visible data surface is seven `route.ts` files.**

**One writer, one file.** SQLite via better-sqlite3, WAL, shared by `geo-web` and
`geo-worker`. The runner issues an `UPDATE runs` after every job
(`src/pipeline/runner.ts:105`), so a 135-call run performs 135 counter writes
against a store that permits one writer at a time.

---

## 2. What we are building

1. **Accounts and organizations.** Sign in by email, belong to an organization,
   see only that organization's data.
2. **Self-service onboarding.** Describe the company, name the topics customers
   ask about, get generated questions and a proposed competitor set to edit.
3. **Per-organization operations.** Runs, thresholds, Slack, Notion and Linear
   become per-organization rather than per-deployment.

---

## 3. Decisions to settle before writing code

### 3.1 Which auth library

Verified against the npm registry and the vendored Next docs, not from memory.

| | Cost | Sessions | Next 16 | Organizations |
|---|---|---|---|---|
| **Better Auth 1.7.4** | free, MIT | your existing `geo.db` | peer range names `^16.0.0`; docs handle the `proxy.ts` rename | **first-party plugin, free** |
| Auth.js / NextAuth v5 | free | needs an ORM adapter | beta for ~3 years, maintenance mode since early 2026 | DIY |
| WorkOS AuthKit | free to 1M MAU | their servers | clean `^16` range | **included free** |
| Clerk | $25/mo + **$100/mo** for orgs | their servers | range caps near 16.1 | paid add-on |
| Auth0 | free to 25k MAU, **$150/mo** for orgs | their servers | v4 required | paid add-on |

**Recommendation: Better Auth**, with the magic-link and organization plugins,
sessions in the existing SQLite file.

Three reasons specific to this codebase. It is the only in-process option whose
peer range names Next 16 and which is actively released. Sessions land in the
database the worker already opens, so the worker can resolve membership without
a network call — a hosted provider puts identity in a system `geo-worker` cannot
reach. And the organization plugin is exactly the primitive the product needs,
free, where Clerk charges $100/mo and Auth0 $150/mo for the same concept.

**Do not pick Auth.js.** Beyond the beta and maintenance-mode status, it has an
open, unfixed class of `basePath` bugs — and this app is served at `basePath:
'/geo'`. Issue #13034 has been open since June 2025 with the fix PR unmerged for
over a year, and five older basePath issues are also open. It would also force
Drizzle into a codebase deliberately kept ORM-free, since no better-sqlite3
adapter exists.

**One concrete gotcha to budget for.** Better Auth declares
`better-sqlite3: ^12.0.0` as a peer; this repo pins 13.0.3. `deploy.sh` runs
`npm ci`, which is strict, so expect `ERESOLVE` on the server. Plan an
`overrides` entry in `package.json` and verify the deploy before relying on it.

**Runner-up: WorkOS AuthKit**, genuinely free to 1M MAU with organizations
included. Choose it if the team would rather not own email deliverability and
token expiry at all. Its cost is the mirror image: identity lives off-box, so
the worker and every script needs another way to resolve membership.

**Do not hand-roll.** The ~300 lines is not the expense. Token expiry semantics,
replay, rate limiting, session rotation and email deliverability are.

### 3.2 How the tenant filter is enforced

Every query today is a string literal passed to three thin helpers in
`src/lib/db.ts`. Roughly 27 statements are reachable from the web and another 24
from the worker and integrations.

Threading an `orgId` parameter through every function is cheapest to start and
worst to live with: a forgotten `AND org_id = ?` returns another tenant's rows
with a 200, and nothing catches it. A request-scoped context solves ergonomics
but not correctness, because a raw `all()` call is still free to ignore it — and
the worker, the scripts and the Slack bot have no request at all.

**Recommendation: a data-access layer, with the raw helpers made private.** This
is also what Next's own authentication guide recommends. The mechanism that makes
it real:

1. Rename `all` / `get` / `run` to `unsafeAll` / `unsafeGet` / `unsafeRun` and
   stop exporting them from `@/lib/db`; move them behind an internal module
   marked `import 'server-only'`.
2. Export instead a scoped factory, `forOrg(orgId)`, returning helpers that
   append the org predicate, plus a `verifySession()` that resolves
   `{ userId, orgId }` from the session cookie.
3. **The rename is the enforcement.** After step 1 every remaining call site is a
   compile error, so `npm run typecheck` enumerates the work exactly, and a later
   omission cannot compile. Neither of the other two patterns has that property.

Note one sharp edge: wrapping `verifySession()` in React `cache()` memoises per
render pass, which does nothing for route handlers — and these are all route
handlers. Resolve per request inside the handler.

### 3.3 How a brand is shared between organizations

`is_self` is not a property of a brand. It is a property of the pair
*(organization, brand)* — Datadog is a competitor to Lemma and "self" to Datadog.
Aliases may be per-organization too.

**Option A, brands are per-organization rows.** Strongest isolation, simplest to
reason about, and every customer re-enters the same competitors.

**Option B, a global catalogue plus an `org_brands` join**, with `is_self` and
alias overrides on the join row. One canonical spelling and alias set, which
directly helps extraction quality, at the cost of a join everywhere and a product
question about whether one customer's correction benefits everyone.

**Recommendation: B**, because extraction accuracy is the product and the alias
set is the lever on it. Keep per-organization overrides so a customer can fix
their own view without editing the shared catalogue.

### 3.4 How N organizations share one provider budget

The worker runs one run at a time, deliberately (`src/worker/index.ts:51`).
`RUNNER.concurrencyPerProvider` is applied per `executeRun` call and nothing
coordinates across runs.

Strict FIFO means the last organization's daily run finishes after everyone
else's, and one slow tenant blocks the queue. Removing the mutex without a
process-wide limiter multiplies in-flight calls against rate limits that are
account-wide, not per-tenant.

**Recommendation: per-organization queues, one process-wide limiter, round-robin
claiming rather than oldest-first**, plus a priority lane so a new signup's first
run jumps ahead of scheduled daily runs. Fairness is the requirement; total
throughput is capped by the provider accounts either way.

### 3.5 Slack, and whether Socket Mode survives

The bot is a single Socket Mode app built at module scope
(`src/integrations/slack.ts:471-477`). Socket Mode is per app install; several
customer workspaces cannot share one socket cleanly.

**Recommendation: accept that multi-tenant Slack means the OAuth and HTTP events
model**, with a `team_id` to organization mapping and a membership check before
`/geo run` queues anything. This is the largest single integration change in the
plan and the best candidate for deferring — see section 9.

---

## 4. Data model

New tables: `organizations` (name, slug, domain, the sales-context blurb, and
`self_brand_id`), `users`, `memberships` (role, unique on user and organization),
`invitations`, `org_brands` (`is_self`, alias overrides), `org_integrations`
(provider, encrypted token, channel and workspace ids). Sessions come from the
auth library.

Existing tables gain `org_id`: `queries`, `runs`, `answers`, `mentions`,
`suggestions`, `run_requests`. Every index gains a leading `org_id`. `is_self`
and `aliases` move off `brands` per 3.3.

**Also add `brands.domains`.** `src/lib/metrics.ts:253` currently reads
competitor domains from the `SEED_BRANDS` constant because the table has no such
column, which means **any competitor created through the existing approve path is
invisible to source attribution forever.** That is a live bug today, not only a
multi-tenancy one.

**Denormalise `org_id` onto `answers` and `mentions`** rather than always joining
`runs`. Metrics already joins `runs` everywhere so the join is nearly free there,
but `GET /api/answers/[id]` does not, and that is exactly where the filter would
be forgotten.

**Migration machinery does not exist yet.** `scripts/migrate.ts` is a single
`CREATE TABLE IF NOT EXISTS` block with no `ALTER TABLE` path, and `deploy.sh`
runs it on every deploy. Adding `org_id` to seven tables needs new, idempotent
migration code. No table currently has a UNIQUE constraint and no foreign key has
`ON DELETE`; add both with the org columns, and design organization deletion at
the same time.

---

## 5. Every place that leaks today

Ordered by how quietly it fails. The first three return plausible numbers rather
than errors, which is the dangerous kind.

**`dailyTotals` (`metrics.ts:62`) is the denominator.** Visibility is
`hits / total * 100`. Filter `hits` but not `total` and every customer's headline
number is silently divided by the whole platform's volume. Nothing looks broken.

**`recentDates` (`metrics.ts:39`) defines the time window** for every other
function, including the Slack digest and the Notion report. Unfiltered, one
customer's reporting window is set by whichever customer ran most recently.

**`getSources` competitor check (`metrics.ts:249`)** flags domains against every
organization's brand names, leaking one customer's competitor set into another's
UI as a badge.

Also required but loud if missed: `brandDays`, the `getOverview` self lookup, the
`getSources` answer scan, the `getSignals` untracked-brand aggregate, and all
five statements in `api/prompts/route.ts` — the window function there must be
filtered inside the subquery, not outside `WHERE rn = 1`.

**Two endpoints are direct object references, not filter problems.**
`GET /api/answers/[id]` hands a validated integer straight to the query, so
incrementing the id walks every organization's raw answers.
`POST /api/suggestions` has the same hole on a *mutating* endpoint. Both need
ownership checks that return 404.

**One client-bundle leak.** `src/app/answers/[id]/answer-detail.tsx:5` imports
`PROJECT` and `SEED_BRANDS` into a **client** component. Today that ships one
company's competitor list to the browser, which is harmless with one company.
Once brands are per-organization it is cross-tenant data in a JavaScript chunk.
It must come from the API response — `mentions` already carry `brandName` and
`isSelf`.

**One measurement problem.** The extractor's eval builds its roster from the live
`brands` table (`scripts/eval.ts:206`) and samples production answers. The
accuracy score would then move whenever a customer edits their brand list. Pin
the golden set, or the instrument measures customers rather than the extractor.

---

## 6. Onboarding

### The flow

1. Sign in by email — magic link, no password to manage.
2. Create the organization: name, domain, and a paragraph describing what the
   company does. That paragraph is not decoration; it is the `PROJECT.context`
   string that today feeds the question generator, the Linear scan and the Notion
   narrative.
3. Name five to ten topics customers ask about.
4. Generate the tracked questions, shown for editing before anything is tracked.
5. Propose competitors, with accept, remove and add.
6. First run, then a dashboard that is not empty.

### Most of the intelligence already exists

- **Question generation** is `scripts/seed.ts:42-63`: a forced tool call that
  expands a question into variations, with a five-lane concurrency pool and an
  idempotency check already written. It needs its hardcoded `PROJECT.context`
  turned into a parameter.
- **Competitor suggestion is nearly free.** `runLinearScan()` already takes
  `(projects, queries, competitors)` and emits `{kind, text, rationale}` — both
  halves of onboarding in one call. **Only the `projects` input is
  Linear-specific**, and only inside `buildScanPrompt()`. Swap it for the
  customer's topics and roughly forty lines are untouched.
- **The review UI already exists.** `suggestions.source` already has a default,
  so onboarding proposals can be ordinary `suggestions` rows with
  `source = 'onboarding'`, reusing the approve path and the Suggestions page
  wholesale. No schema change.
- **Continuous discovery is already built.** The extractor returns `other_brands`
  and `getSignals` surfaces anything seen in three or more recent answers as a
  new competitor. That is the ongoing half of "AI identifies competitors" — and
  it is worth saying plainly that **the competitor list gets more accurate the
  longer you run**. It needs answers, so it is not available during onboarding.

**Genuinely new:** one prompt that turns topics into base questions, per-org
context in the database, `brands.domains`, and the wizard UI itself. Every
existing page is a dashboard, not a flow.

### A known defect sits directly under this feature

`DECISIONS.md` records that a `strict: true` tool schema whose array holds bare
strings is unreliable — one Sonnet call in four returned the field name as its
only element — and that `maxItems` is rejected outright. `linear.ts` already uses
the correct shape. **Two live call sites still use the broken one, and they are
exactly the machinery onboarding reuses:** `scripts/seed.ts:33-37`
(`variations` as an array of strings) and `src/pipeline/extract.ts:64-69`
(`other_brands`, which feeds competitor discovery).

Converting both belongs in this work. Otherwise onboarding inherits a known
one-in-four failure on both of its core features.

---

## 7. Cost and capacity

A run is 135 answer calls plus one extraction each, up to **270 model calls**.
At verified list prices, assuming search-heavy grounded answers:

| leg | subtotal |
|---|---|
| Anthropic answers, 45 calls | ~$3.80 |
| OpenAI answers, 45 calls | ~$4.10 |
| Gemini answers, 45 calls | ~$2.70 |
| Haiku extraction, 135 calls | ~$0.90 |
| **one run** | **≈ $11.50** |

So an organization on a daily cadence costs roughly **$345 a month in model
calls alone**. That number, not engineering effort, is what decides pricing and
whether the provider set and variation count become plan limits rather than
constants.

**Two cost cliffs worth writing down.** Gemini's Google Search grounding is free
for the first 5,000 requests per month *shared across all Gemini 3.x models* — at
45 grounded calls per run that is about three organizations on a daily cadence
before it starts costing $14 per thousand. And both the OpenAI and Gemini models
have a long-context price tier that heavy search retrieval can cross, roughly
doubling that leg.

**Do not backfill per tenant.** A full backfill is about **$90 and one to two and
a half hours per organization**, and the repo's own honesty note is explicit that
backfilled dates are simulated. Showing them to a paying customer as history is
the one thing that note forbids.

Two ceilings are independent of money. Provider rate limits are account-wide, so
parallel organizations contend for the same budget — OpenAI at three lanes is
already the critical path. And SQLite permits one writer; at 135 counter writes
per run, concurrent runs will contend on the write lock. **Moving off SQLite is
not required to ship multi-tenancy, but it is the first thing that breaks under
load.** Name the trigger point rather than discover it.

---

## 8. Cold start

A first run is 10 to 20 minutes and about $11.50, paced by OpenAI's three lanes.
Ranked by value for effort:

1. **Fill the review screen before any run.** The suggestion machinery is two
   model calls and a few seconds. The customer types topics and immediately sees
   questions and competitors to approve. This removes most of the empty feeling
   and is almost entirely existing code.
2. **Show live progress.** `RunOptions.onProgress` exists, the run counters are
   bumped after every job, and the Runs page already polls every five seconds. A
   "42 of 135 answers collected" bar is a UI change, not a pipeline change.
3. **Run a fast subset first.** `RunOptions.limit` already exists: five prompts
   across three providers is fifteen calls, about 90 seconds and $1.30, enough
   for a real first number — badged as partial, which the coverage series already
   supports.
4. **Or stage by provider.** `RunOptions.providers` already exists; Anthropic
   alone is eight lanes, roughly four minutes and $4.
5. **Never show synthetic numbers to a customer.** `scripts/seed-synthetic.ts`
   exists for demo history and must be unreachable from a real tenant.

Note the structural blocker: runs are globally serialised today. Ten
organizations signing up in an afternoon means the tenth waits hours for its
first data. Per-org queues and a priority lane (3.4) are a prerequisite for
onboarding, not a later optimisation.

---

## 9. Phasing

**Phase 0 — domain and TLS.** Section 0. Blocks everything.

**Phase 1 — accounts and isolation.** Better Auth with magic link and
organizations; the data-access layer from 3.2 (do the rename first, let the
compiler enumerate the work); `org_id` through the schema and every query;
ownership checks on the two direct-object-reference endpoints; the client-bundle
fix; migration machinery. Migrate existing Lemma data into organization 1. Remove
the nginx basic auth at the end of this phase, not before. **This is the phase
that cannot be rushed, because everything after it assumes isolation holds.**

**Phase 2 — onboarding.** Organization creation, topics to questions, competitor
proposal, first-run experience. Fix the two bare-string tool schemas as part of
it. Move `PROJECT` and the seed constants into rows.

**Phase 3 — per-organization operations.** Run scheduling and fairness, per-org
thresholds and quotas, Notion and Linear credentials, per-org scripts.

**Phase 4 — Slack multi-tenancy.** OAuth and the events model. Deliberately last:
largest integration change, and the product is useful without it. Until then run
Slack for one internal workspace and say so.

---

## 10. Deliberately out of scope

Billing and plan enforcement, SSO and SCIM, data residency, an audit log,
per-customer rate limiting, and moving off SQLite. Each is real work this plan
neither includes nor precludes.

---

## 11. Risks worth naming

**A missed filter is invisible.** The failures in section 5 produce plausible
numbers, not errors. Mitigation is structural — decision 3.2 — plus a test that
runs every metrics function against a two-organization fixture and asserts the
numbers match a single-organization fixture exactly.

**Cost scales linearly and nothing caps it.** `POST /api/trigger` takes no
argument limiting the work it queues. At about $11.50 a run, per-organization
quotas belong in Phase 1, not Phase 3.

**The demo box is one shared password on plain HTTP.** Adequate for a hackathon,
inadequate for a customer, and it should not quietly become the security model.

**Extraction quality is the product**, and decision 3.3 is a bet on whether a
curated shared catalogue beats per-customer lists. Either way the eval harness
must stop reading live tenant data, or there is no way to tell whether a change
helped.
