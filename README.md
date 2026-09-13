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

## Quickstart

```bash
npm install
cp .env.example .env      # fill in API keys
npm run migrate           # create the SQLite schema
npm run seed              # brands + 15 base queries + generated variations
npm run run-once          # one live run (add --limit 3 while testing)
npm run dev               # dashboard at http://localhost:3100/geo
npm run worker            # cron + Slack bot + run_requests poller
```

## Scripts

| Command | What it does |
|---|---|
| `npm run migrate` | Create/patch the SQLite schema (idempotent) |
| `npm run seed` | Insert brands, base queries, and AI-generated variations |
| `npm run verify-models` | Check the model ids in `src/lib/config.ts` against the live APIs |
| `npm run run-once` | Execute one run now (`--limit N` to sample fewer queries) |
| `npm run backfill` | Replay the pipeline across N simulated past dates |
| `npm run seed-linear` | Create the demo roadmap projects in Linear |
| `npm run export-evalset` | Sample answers into `eval/evalset.json` for hand labeling |
| `npm run eval` | Score the extractor against the labels (precision / recall) |

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

## Layout

| Path | Owner | Contents |
|---|---|---|
| `src/pipeline/` `scripts/` | Workstream A | providers, extraction, runner, backfill, evals |
| `src/app/` | Workstream B | dashboard pages and API routes |
| `src/integrations/` `src/worker/` | Workstream C | Slack, Notion, Linear, scheduler |
| `src/lib/` | shared (Dev A owns) | config, db, metrics, types |

Design reference for the dashboard: `docs/mockups/`.

Deploy: `ssh root@5.78.222.163`, then `cd /var/www/html/geo && ./deploy.sh`.
