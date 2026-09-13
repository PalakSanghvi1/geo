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
