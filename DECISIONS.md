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
- **pm2 boot persistence** enabled (`pm2 startup systemd` + `pm2 save`, unit `pm2-root`
  is `enabled`), so both processes come back after a VPS reboot.
