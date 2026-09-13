# GEO — AI visibility tracker

Rank tracking for AI answers. GEO runs a fixed set of natural-language customer
questions against Claude, GPT and Gemini every day **with web search on**, then
measures how often a brand is mentioned, where it ranks against competitors, how
positively it is described, and which sources the models cited.

Demo subject: **Lemma** (uselemma.ai), tracked against 9 competitors in the AI-agent
observability category.

- **Visibility** — % of answers that mention the brand
- **Position** — order of first mention among tracked brands (lower is better)
- **Sentiment** — −100…+100, averaged over mentions
- **Sources** — domains and URLs the models cited

Alerts land in Slack, weekly reports publish to Notion, and the tracked-query list
is fed by suggestions read from the team's Linear roadmap.

**Status.** The pipeline (providers, extraction, runner, backfill), the metrics layer,
the read/trigger API routes and the eval harness are implemented. The dashboard pages,
the worker loop (`src/worker/index.ts` is still the boot placeholder) and the
Slack / Notion / Linear integrations are in progress.

## Quickstart

```bash
npm install
cp .env.example .env      # fill in API keys
npm run migrate           # create the SQLite schema
npm run seed              # brands + 15 base queries + generated variations
npm run verify-models     # confirm the model ids resolve on your keys
npm run smoke             # one real call per provider + one extraction
npm run run-once          # one live run (add -- --limit 3 while testing)
npm run status            # what's in the database right now
npm run dev               # dashboard at http://localhost:3100/geo
npm run worker            # cron + Slack bot + run_requests poller
```

Anything after `--` is passed to the script, e.g. `npm run run-once -- --limit 3`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3100 (`basePath: /geo`) |
| `npm run worker` | Background worker: cron, `run_requests` poller, Slack bot |
| `npm run migrate` | Create/patch the SQLite schema (idempotent) |
| `npm run seed` | Insert brands, base queries, and AI-generated variations |
| `npm run verify-models` | Check the model ids in `src/lib/config.ts` against the live APIs |
| `npm run smoke` | One real search-grounded call per provider plus one extraction — tells a pipeline fault from a provider outage |
| `npm run run-once` | Execute one run now (`--limit N`, `--date`, `--providers`, `--trigger`) |
| `npm run backfill` | Replay the pipeline across N simulated past dates (`--days`, `--limit`, `--providers`, `--force`) |
| `npm run status` | Print counts, recent runs, the current scoreboard, and recent failures |
| `npm run export-evalset` | Sample answers into `eval/evalset.json` for hand labeling (`--n N`) |
| `npm run eval` | Score the extractor against the labels (`--file`, `--target`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed-linear` | Create the demo roadmap projects in Linear — **not implemented yet** (`scripts/seed-linear.ts` is missing) |

`run-once`, `backfill`, `smoke` and `eval` all make paid API calls. `migrate`, `status`
and `typecheck` do not.

## Architecture

```
nginx :80 /geo ──▶ pm2 geo-web (Next.js :3100) ──┐
                                                 ├──▶ data/geo.db (SQLite, WAL)
pm2 geo-worker ──────────────────────────────────┘
  ├─ node-cron        daily run + weekly Notion/Linear jobs
  ├─ run_requests     poller (dashboard button + Slack /geo run)
  └─ Slack bot        Socket Mode — no public URL required
```

The web app never calls an LLM directly. Anything that wants a run inserts a row
into `run_requests`; the worker polls it. Scheduled, manual and Slack-triggered
runs therefore share one code path.

## Reliability

Full write-up: **[`docs/reliability-brief.md`](docs/reliability-brief.md)** — system
topology, failure handling, the eval harness, and what is real vs. simulated.

The short version:

- **A run never throws.** Every failure becomes a row — an `answers` row with
  `status='error'`, and a run finalized `partial`. A crashed run would leave a day whose
  denominator silently shrank, which corrupts a percentage rather than merely losing data.
- **Retries in one place** (`src/pipeline/providers/index.ts`): 90 s per-call timeout, 2
  retries at 2 s and 8 s on 429 / 5xx / network errors, vendor SDK retries disabled. A
  rejected model id **or** a 429 swaps to the fallback model immediately without sleeping,
  because quota is per model tier.
- **Independent concurrency pool per provider** (4 each), so a throttled provider slows
  only itself.
- **Extraction is a separate failure domain** from collection: a failed extraction keeps
  the answer and records `extraction_failed`, never loses the answer text.
- **Partial runs are first-class**: metrics are computed over `ok` answers only and
  coverage (`ok ÷ attempted`) is reported alongside as its own series.
- **Extraction is evaluated, not assumed** — `npm run eval` scores it against hand labels.
  It has **not been scored yet**; no accuracy numbers are claimed anywhere.
- **The answers are real; the history dates are simulated.** Backfill runs the real
  pipeline repeatedly on one day with past `run_date` labels. See `scripts/backfill.ts`.

## Layout

| Path | Owner | Contents |
|---|---|---|
| `src/pipeline/` `scripts/` | Workstream A | providers, extraction, runner, backfill, evals |
| `src/app/` | Workstream B | dashboard pages and API routes |
| `src/integrations/` `src/worker/` | Workstream C | Slack, Notion, Linear, scheduler |
| `src/lib/` | shared (Dev A owns) | config, db, metrics, types |

Design reference for the dashboard: `docs/mockups/`.
Reliability brief: `docs/reliability-brief.md`.

Deploy: `ssh root@5.78.222.163`, then `cd /var/www/html/geo && ./deploy.sh`
(`git pull --ff-only` → `npm ci` → `npm run migrate` → `npm run build` →
`pm2 restart ecosystem.config.js --update-env` → `pm2 save`). `.env` and `data/` are
gitignored, so a deploy never touches credentials or collected history.
