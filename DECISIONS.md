# Decisions log

On-the-fly calls made during the build that aren't already settled in `BUILD_PLAN.md`.
Append, don't rewrite. One line each, newest at the bottom.

## Phase 0 — Dev A

- **Repo**: `github.com/PalakSanghvi1/geo`, public. Folder on disk is `Desktop\GEO`;
  the npm package name is lowercase `geo` (npm rejects capitals).
- **Next.js 16.3.5 / React 19 / Tailwind 4**, App Router, `src/` dir, **no ESLint**
  (a lint failure must never block `next build` on demo day).
- **Node**: local is v24.13.0, the VPS is v22.22.1. `better-sqlite3` is native, so the
  VPS always rebuilds it via `npm ci` — never copy `node_modules` between them.
- **`.env` loading**: `src/lib/env.ts`, a 20-line parser imported first by every script
  and the worker. Chosen over `dotenv` or `--env-file` flag forwarding through `tsx`,
  which behaves differently across Node versions.
- **`next start` over the standalone server** for pm2: fewer moving parts on demo day,
  even though `output: 'standalone'` is set.
- **Model ids in `src/lib/config.ts` are unverified** until API keys land. Each entry
  carries a fallback and the runner swaps automatically on a model-not-found error.
  Run `npm run verify-models` once keys exist and update this line with the result.
- **`answers.other_brands`** added to the schema before freeze (untracked brands the
  extractor spots) — powers the "new competitor spotted" signal in the Slack digest.
- **Path is lowercase `/geo` everywhere** (was `GEO`): `/var/www/html/geo`,
  `basePath: '/geo'`, `http://5.78.222.163/geo`. Linux is case-sensitive and the mixed
  spelling was a demo-day footgun. The Windows working copy is still `Desktop\GEO`,
  which is harmless — Windows paths are case-insensitive.
- **The VPS is shared, not ours alone.** `/var/www/html` is a live PHP staging portal
  ("cape-fear-staging") with its own git repo and its own `.env`. Our app is confined to
  `/var/www/html/geo`. Do not run git commands from `/var/www/html`, and do not touch
  that `.env`.
- **nginx**: added one `location ^~ /geo` proxy block to the existing
  `listen 80 default_server` server in `/etc/nginx/sites-available/cape-fear-staging`.
  `^~` is required — that block has regex `location ~* \.(md|sh|…)$` deny rules which
  would otherwise outrank a plain prefix match. A timestamped `.bak.<epoch>` of the
  config sits beside it. Always `nginx -t` before `systemctl reload nginx`: a bad config
  takes the portal down with us.
- **Model ids verified 2026-09-13** via `npm run verify-models` (hits each provider's
  REST list endpoint, no SDK guessing). Confirmed real: `claude-sonnet-5`,
  `gpt-5.6-terra`, `claude-haiku-4-5-20251001`. The Anthropic fallback was wrong —
  `claude-sonnet-4-5` does not exist on this account; changed to `claude-sonnet-4-6`.
- **Gemini: resolved.** The first key returned 403 `API_KEY_SERVICE_BLOCKED` on every
  method — an API restriction excluding `generativelanguage.googleapis.com`, not a bad
  key. Replaced with a new AI Studio key (the newer `AQ.`-prefixed format); all methods
  now return 200. Gemini 3.1 Pro is published only as **`gemini-3.1-pro-preview`** — a
  bare `gemini-3.1-pro` does not resolve — with `gemini-2.5-pro` as fallback.
- **Gemini auth uses the `x-goog-api-key` header, never `?key=`.** Query-string keys leak
  into access logs and proxy traces. Both work; the header is the one we ship.
- **Final verified set (2026-09-13, `npm run verify-models` → "all ids confirmed"):**
  `claude-sonnet-5` / `claude-sonnet-4-6`, `gpt-5.6-terra` / `gpt-5`,
  `gemini-3.1-pro-preview` / `gemini-2.5-pro`, extraction `claude-haiku-4-5-20251001`.
- **CRLF bit us once already.** The `.env` uploaded from Windows had CRLF endings, so
  `. ./.env` in bash left a trailing `\r` on every value and curl reported "Malformed
  input to a URL". Node is immune (our `env.ts` trims) but shell tooling is not. Added
  `.gitattributes` forcing LF on `*.sh`, `.env.example` and `ecosystem.config.js`, and
  ran `sed -i 's/\r$//' .env` on the VPS. Re-run that after any future upload from Windows.
- **pm2 boot persistence** enabled (`pm2 startup systemd` + `pm2 save`, unit `pm2-root`
  is `enabled`), so both processes come back after a VPS reboot.

## Phase 0 + C1 — Dev C

- **Slack workspace is a real company workspace** (`Sangforth Technologies`), not a
  throwaway `geo-hackathon` one. Bot scopes are exactly the three the plan calls for:
  `chat:write`, `commands`, `app_mentions:read`. `channels:read` is deliberately not
  granted, so `conversations.info` returns `missing_scope` — harmless, nothing reads it.
  Because the workspace is real, the bot only ever posts to `SLACK_CHANNEL_ID`.
- **Cron does not call `executeRun` directly.** The daily schedule inserts a
  `run_requests` row like everything else and lets the poller execute it, so scheduled,
  dashboard and Slack runs share one code path (BUILD_PLAN §1.5) instead of two.
- **Only `manual` runs post a completion message to Slack.** Scheduled runs are covered
  by the daily digest (Phase C2); posting both would double up in `#geo` every morning.
- **`src/worker/run-bridge.ts`** wraps Workstream A's runner behind a dynamic import with
  a stub fallback, so the worker boots and the full request → claim → execute → notify
  path is testable before A merges. The import specifier is held in a variable on purpose:
  a literal path fails `tsc --noEmit` while `src/pipeline/runner.ts` does not exist.
  Stub runs are written as `status='partial'` with zero calls so they can never be
  mistaken for collected data on the Runs page.
- **No top-level `await` in worker or integration code.** The package is CommonJS (no
  `"type": "module"`), and `tsx`/esbuild rejects top-level await in CJS output. Wrap in
  an async `main()`.
- **One Socket Mode worker at a time.** A laptop worker and the VPS worker share the same
  app token, and Slack delivers each command to only one connection — so stop the local
  `npm run worker` before the VPS runs the same code, or slash commands answer
  intermittently.
- **Run requests are claimed in a transaction** (`SELECT … then UPDATE … 'picked_up'`)
  and the poller refuses to start a second run while one is in flight.

## Phase C2 — Dev C

- **`scripts/seed-linear.ts` sits in Workstream A's directory on purpose.** §2 gives
  `scripts/` to Dev A, but §8 Phase C2 names this exact path as a Dev C deliverable and
  `package.json` already wires `npm run seed-linear` to it. Flagging it so the boundary
  looks deliberate at merge time — Dev C touches no other file under `scripts/`.
- **Linear personal API keys go in `Authorization` raw, with no `Bearer ` prefix.**
  With the prefix every request fails authentication. True for the seed script and the
  scan alike.
- **Anthropic strict tool schemas reject `maxItems` on an array** (HTTP 400:
  "for 'array' type, property 'maxItems' is not supported"). The "at most 5 suggestions"
  cap is therefore enforced three ways: in the prompt, in the schema `description`, and
  with a hard `.slice(0, 5)` on the result.
- **The digest posts on every completed queued run, and there is no separate daily
  digest cron.** The daily cron queues a run; that run's completion posts the digest.
  Wiring a second timed digest would double-post every morning. Backfill calls the
  runner directly and never enters the queue, so replaying history posts nothing.
- **Suggestion dedupe key** = text trimmed, internal whitespace collapsed, lowercased,
  compared across every row regardless of source or status, and within the incoming
  batch too. A re-scan of an unchanged roadmap therefore inserts nothing.
- **`buildDigest()` is the single Slack body.** Run completions post the digest plus a
  one-line footer naming the run, rather than a second, differently-worded summary that
  could disagree with it.
- **The digest's `date` argument labels only.** `metrics.ts` exposes no per-date query,
  so the numbers are always the latest day with answers; when the requested date differs,
  the digest says so rather than implying it is historical.
- **The stub run-bridge is deleted now that `src/pipeline/runner.ts` is merged.** The
  worker imports `executeRun` directly and uses the returned `RunSummary`. Keeping the
  dynamic-import fallback would have meant a typo could silently stub a real run — the
  opposite of what the reliability story needs.
- **`src/integrations/slack.ts` does not import from `src/pipeline/`.** It declares the
  fields of `RunSummary` it needs as a structural interface, so integrations depend on a
  shape rather than on Workstream A's internals.
- **Run completions post a per-provider coverage line** (`anthropic 45/45 ✅ ·
  openai 44/45 ⚠️`) from the runner's own `byProvider` counts. This is where a degraded
  run becomes visible without opening the dashboard.
- **Gap flagged, not filled: there is no API route that pushes a suggestion to Linear.**
  `src/app/api/suggestions/route.ts` handles approve/dismiss only and says pushing to
  Linear is Workstream C's job, but the route lives in Workstream B's directory.
  `createIssue(suggestion)` is exported and ready; someone who owns `src/app/` needs to
  add the endpoint that calls it, or the demo's "push to Linear" button has no backend.

## Phase C3 — Dev C

- **Notion rejects any URL longer than 2000 characters**, and it is Notion's servers that
  fetch the QuickChart image. With ordinary `JSON.stringify` the plan's "Lemma + top 4
  competitors" chart came to ~2500 characters and had to be trimmed to 2 competitors.
  Two changes made the specified chart fit: the config is serialized in QuickChart's
  JSON5-tolerant dialect (unquoted keys, single quotes — `encodeURIComponent` expands
  every `"` to `%22` but leaves `'` alone), and chart values are rounded to whole percent
  because the exact figures are in the scoreboard table. Result: **1870 characters with
  the longest real brand name**, verified rendering as a 230 KB PNG. The report still
  degrades 4 → 3 → 2 → 1 → no image if a future chart outgrows the budget.
- **QuickChart's default renderer is Chart.js v2** (`options.title`, `options.legend`,
  `options.scales.yAxes`). Modernising those keys to v3/v4 syntax silently drops the axes
  and the title unless `&v=3` is also appended to the URL.
- **A `strict: true` tool schema whose array holds bare strings is unreliable.** One live
  Sonnet call in four returned the degenerate `{"takeaways": ["takeaways"]}` — the field
  name as the only item. Wrapping each item in an object with a named `text` field fixed
  it across 8 consecutive runs. Worth applying to any other forced-tool call in the repo
  that wants a list of strings.
- **The weekly report is labelled with the week it covers, not the day it runs.** The
  Monday cron resolves the previous Sunday, so a report published on Monday the 14th is
  titled "week ending 2026-09-13".
- **`publishWeeklyReport` degrades rather than aborting.** If the narrative model call
  fails the page still publishes without takeaways; an empty database produces a shorter
  page (no table, no image — Notion rejects a table with no rows) instead of a crash.
- **Unverified until the first real publish:** that `pages.create` accepts the inline
  `table` + `table_row` children in one call. If it rejects them, create the page without
  the table and append it with `blocks.children.append`.
## Phase B1 — Dev B

- **Light theme, per the mockups.** The Phase B1 bullet in the plan says "dark theme
  is fine to hardcode", but the section 7 design reference and all four PNGs in
  `docs/mockups/` specify the light theme (`#F6F5F2` canvas, `#FCFCFB` cards). The
  mockups win — they are the visual spec the demo is judged against.
- **No shadcn/ui.** Phase 0 never ran `shadcn init` (no `components.json`), and these
  four screens need about eight primitives. Hand-rolled in `src/app/_components/ui.tsx`
  against the mockup tokens rather than adding a component registry mid-build.
- **Design tokens live in `src/app/globals.css`** as a Tailwind 4 `@theme` block, plus
  two custom utilities: `overline` (IBM Plex Mono label caps) and `numeric`
  (tabular figures, so polled numbers don't jitter).
- **Mock mode is opt-in, not opt-out.** `NEXT_PUBLIC_USE_MOCK=1` renders
  `src/lib/mock.ts`; unset (the VPS default) always calls the real API routes, and
  mock mode paints a MOCK DATA badge in the header. A dashboard that can quietly
  show invented numbers during judging is worse than one that errors.
- **The dashboard fetches client-side** from `/geo/api/*`. The `basePath` has to be
  written into the fetch URLs (`src/app/_lib/fetcher.ts`) — Next rewrites `<Link>`
  and asset paths, not `fetch`. Filters are client state, and the Runs page polls, so
  one client-side data path covers every screen.
- **Brand → colour lives in `src/app/_components/brand-colors.ts`**, read by both the
  chart and the scoreboard. Two independent colour orderings would silently mislabel
  which line is which.
- **The chart draws five brands** (self + top four competitors); ten lines is unreadable
  and the end-of-line labels collide. The scoreboard carries the full list.
- **The backfilled ↔ live boundary is derived**, not hardcoded: the earliest run whose
  trigger is not `backfill`, read from `/api/runs`. It moves on its own as live runs
  land during judging.
- **Stat card deviation — "Avg position".** The mockup's sub-line reads "↑ from 2.6 last
  week", but `OverviewResponse` carries no prior-period position, and section 3 freezes
  the shape. The card shows rank instead ("#3 of 10 tracked brands"). *Dev A: adding
  `avgPositionPrev7` to `self` would let us restore the mockup line — small change,
  your call.*

## Phase B2 — Dev B

- **Answer highlighting is presentation only.** Brand names in the answer body are marked
  with a plain string match over `SEED_BRANDS` names + aliases (longest first, so
  "Weights & Biases Weave" beats a bare "Weave"). The authoritative mention list — order,
  sentiment, quote — still comes from the extractor via `/api/answers/:id`. If the two
  ever disagree, the sidebar is right and the highlight is cosmetic.
- **Citations are grouped by domain** with a `×N` count, and Dev A's new `Citation.cited`
  flag renders as a muted "retrieved" tag — the "cited vs merely retrieved" distinction is
  a real part of the sources story and was free once the field existed.
- **Added an "Untracked brands spotted" card** to the answer rail from
  `answers.other_brands`. Not in `answer-detail.png`, but the field exists precisely for
  the "new competitor spotted" signal, and it makes that visible per answer.
- **Omitted "View retry log →" from `runs.png`.** There is no route or endpoint behind it;
  a dead link on the screen judges look at is worse than its absence. Trivial to add once
  something can answer it.
- **Prompts are grouped structurally, not visually.** Each base query and its variations
  render as their own `<tbody>`, and the tag filter operates on groups — so no filter or
  sort can orphan a variation from its parent.
- **A run with zero collected answers reports "no data", not "healthy".** Green on an
  empty set is a claim we cannot support, and reliability is 25% of the rubric.
- **Verified against an empty database**, which is what the VPS looks like before the
  backfill lands: `/api/overview` returns `self: null`, `/api/prompts` and `/api/runs`
  return `[]`, `/api/answers/1` 404s. Every screen renders its empty state; nothing throws.

### Asks for Dev A (contract, not blocking)

- **`Run` has no per-provider breakdown.** The three provider health cards on the Runs page
  are therefore an approximation: `total_calls / 3` each, with `failed_calls` charged to one
  provider. A `by_provider: Record<ProviderId, { ok, total, failed }>` on `Run` would make
  that row honest — it is the most visible reliability surface in the demo.
- **`PromptRow.latestAnswerIds` can't distinguish "not run yet" from "ran and failed"** —
  both are an empty map, so the Prompts table renders the same dash for both.
- Still open from B1: `avgPositionPrev7` on `OverviewResponse.self`.

## Phase B3 — Dev B

- **Suggestion rationales are parsed as `Linear project: <name> — <why>`**, which is the
  shape Workstream C's scan writes. The project heads the card; the rest is the body.
  A rationale that doesn't match renders whole rather than being silently dropped.
- **`POST /api/suggestions { action: 'push-to-linear' }`** is what "Create Linear issue"
  calls, per §7, which puts push-to-linear on this endpoint. The route Dev A shipped
  accepts only `approve | dismiss`, so today the button surfaces the resulting
  `400 Bad Request` inline on the card. Verified against the live route — it does not
  pretend the push succeeded. It starts working the moment the action is added.
- **"Scan again" is omitted** from `suggestions.png`. `runLinearScan()` is a worker
  function on Dev C's branch with no HTTP route; the same reasoning that dropped
  "View retry log" from the Runs page applies — a control that does nothing is worse
  than no control.
- **The right rail says "Linear projects referenced", not "scanned".** The mockup lists
  six projects with active/planned status, but nothing exposes the project list to the
  dashboard. The rail derives project names from the rationales of the suggestions we
  actually have, and a footnote says exactly that. Renaming was preferable to inventing
  a status field.
- **The resolved strip is session-local.** `GET /api/suggestions` returns pending rows
  only, so an approved suggestion cannot be re-fetched. The confirmation row reflects what
  you did in this session and is gone on reload — correct, if slightly surprising.
- **Sources: the share bar is relative to the top domain**, and the percentage beside it
  is share of all citations — the leader's bar is full, which reads better than ten stubs.
  The expanded URL list deliberately shows no subtotal: `citationCount` and
  `sum(urls[].count)` are independent fields in the contract and need not agree.
- **Shared `Button` primitive** in `ui.tsx` (primary / outline / ghost); the Runs page's
  hand-rolled "Run now" button was refactored onto it so there is one button style.
- **Client pages can't export `metadata`**, so per-route browser tab titles fall back to
  the root layout's. Four `layout.tsx` files to set tab titles judges will never look at
  was not worth it.

### Asks for Dev A (contract, not blocking)

- **`getSources` misses competitor-owned subdomains.** It flattens the brand name and
  tests `domain.includes(name)`, so `docs.smith.langchain.com` is not flagged as
  LangSmith-owned. Matching against `brands.aliases` as well as `name` would catch it —
  "which competitor owns the sources the models cite" is a good demo beat and it's
  currently under-reporting.
- **`SourceRow.urls` drops `Citation.title`**, so the expanded list can only label a URL
  with its own path. Carrying the title through would read much better.
- Still open: `Run.by_provider`, `PromptRow` run-status, `avgPositionPrev7`.

## Phase B3 addendum — mock removal and audit fixes (Dev B)

- **`src/lib/mock.ts` is deleted and the `NEXT_PUBLIC_USE_MOCK` flag is gone.** It
  existed only to build the dashboard before Workstream A's API routes landed. They are
  merged and carry real data, so every screen now fetches `/geo/api/...` and nothing
  else. The earlier B1–B3 entries above describing mock mode are history, not current
  behaviour. An empty screen from here on is a real signal about the data, not a
  rendering bug — that is the point of removing the fallback.
- **Audit fixes** (from a read-only pass over the whole dashboard). The ones that
  mattered:
  - **Sentiment was rendering unrounded.** `ScoreboardRow.sentiment` is a mean, so real
    data would have printed `61.666666666666664` in the scoreboard and the stat card.
  - **The chart and the scoreboard could give one brand two different colours.** Colours
    were assigned over the chart's *filtered* brand list, so a brand missing from the
    series shifted every later competitor one slot. `chartBrands()` now assigns over the
    whole scoreboard and filters afterwards — the drift `brand-colors.ts` exists to stop.
  - **A failed refresh blanked a populated page.** With `useRuns(5000)` polling, one
    blip mid-demo replaced a full screen with an error card. Every page now keeps its
    content and shows `ErrorBanner` above it, falling back to the full-page error only
    when there is nothing to show.
  - **Provider health read the newest run**, which during a live run has no counts, so
    all three cards said "no data" above a table full of results. It now reads the newest
    run that has counts.
  - **An `ok` answer with null text was reported as a failed call.** Status and text are
    independent in the contract; they are now separate branches.
  - Brand highlighting is built from the answer's own mentions rather than only
    `SEED_BRANDS`, so a competitor approved through the Suggestions page is highlighted
    in the prose and not just listed in the rail.
  - The suggestions rail no longer says "Today": the stamps are UTC and were being
    compared against the browser's local date. It shows the date and states the zone.
  - Consistency: one `Meter` width, one `Button`, one `ErrorBanner`, one card-title
    class; chart gridlines matched to `--color-hairline`; `text-accent-ink` added for
    accent-coloured text, which failed AA at the brand accent; focus-visible rings;
    `text-ink-faint` reserved for placeholders rather than real values.
  - Dead code removed: `CardHeader` and `ComingSoon` had no call sites left.

## Post-hackathon — Dev C

- **nginx basic auth on `/geo`** (2026-09-13). Before it, the dashboard and the API
  were readable and writable from the public internet with no credentials —
  `POST /api/trigger` queued roughly $11 of model calls anonymously. User `geo`,
  hash in `/etc/nginx/.htpasswd-geo`, config backed up as
  `cape-fear-staging.bak.<epoch>`, `nginx -t` run before reload with an automatic
  restore on failure. It is one shared password over plain HTTP: a door lock on a
  demo box, not a security model. Remove it the day real auth ships. Internal
  traffic is unaffected — both processes talk to 127.0.0.1:3100 and Slack is an
  outbound socket — but links from Slack and Notion now prompt.
- **`docs/multi-tenant-plan.md`** records the scoping for accounts, organizations
  and onboarding. Two findings in it are live bugs, not future work:
  `src/lib/metrics.ts:253` reads competitor domains from the `SEED_BRANDS`
  constant because `brands` has no `domains` column, so any competitor added via
  the approve path is invisible to source attribution; and `scripts/seed.ts:33`
  plus `src/pipeline/extract.ts:64` still use the bare-string strict tool schema
  this file already documented as returning a degenerate result one call in four.
