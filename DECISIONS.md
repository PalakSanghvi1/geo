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
