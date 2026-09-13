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
