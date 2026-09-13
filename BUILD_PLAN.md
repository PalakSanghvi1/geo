# GEO — AI Visibility Tracker: Hackathon Build Plan

> **Audience:** This document is the complete instruction set for Claude Code (Opus) executing a one-day hackathon build. It is written to be followed with minimal questions. All product and infrastructure decisions have already been made — see "Decisions already made" below. Do not re-ask them. When something ambiguous comes up that is not covered here, pick the simplest option that keeps the demo working and note it in `DECISIONS.md` at the repo root.
>
> **Team:** 3 developers (Dev A, Dev B, Dev C), each running their own Claude Code session against their own workstream section of this document. Dev A bootstraps the repo first (Phase 0); B and C start their setup tasks in parallel and begin coding once Dev A's scaffold is pushed.

---

## 1. Context

### 1.1 What we are building

A **GEO (Generative Engine Optimization) analytics tool** — "SEO rank tracking, but for AI answers."

A brand defines a set of natural-language queries its customers might ask an AI (e.g. *"What are the best production monitoring tools for AI agents?"*). The system runs each query (plus AI-generated variations) daily against multiple AI models **with web search enabled**, parses each answer, and measures:

- **Visibility** — % of answers that mention the brand (share of voice)
- **Position** — where the brand appears relative to competitors (order of first mention)
- **Sentiment** — whether the mention is positive / neutral / negative
- **Sources** — which domains/URLs the AI models cited

It shows trends on a dashboard, sends a daily Slack digest, allows on-demand runs triggered from Slack, auto-publishes weekly reports to Notion, and — the original twist — **reads the team's Linear roadmap to suggest new queries and competitors to track** ("You're shipping voice-agent tracing → track *'best voice agent monitoring tools'*").

### 1.2 Demo subject

We track **Lemma** (https://www.uselemma.ai) — production monitoring / observability for AI agents. It is not our company; it's a realistic demo subject in a hot, contested category, which makes AI answers rich.

**Competitors to seed** (self + 9): Lemma (self), Raindrop, LangSmith, Langfuse, Braintrust, Arize, Helicone, Weights & Biases Weave, Galileo, Datadog (LLM Observability).

### 1.3 Hackathon constraints & rubric

- **Build window: 9:30 AM – 4:00 PM Pacific (~6.5 hours).** Judging 4:00–4:40. Submission = working repo + two-minute demo + short system & reliability brief.
- **Rubric:** Technical execution 30% · **Reliability & evaluation 25%** · Usefulness 20% · Originality 15% · Demo clarity 10%.
- The 25% reliability weight is unusual. This plan deliberately includes: per-call retries, graceful provider degradation, a run-status/health page, an extraction **eval harness with a labeled answer set and printed precision/recall**, and a written reliability brief. Treat these as first-class features, not afterthoughts.
- Daily tracking cannot be demonstrated live in one day, so we **backfill demo history**: run the real pipeline multiple times during the day with simulated past run-dates (real answers, simulated dates). We also trigger one fully live run during the demo. The brief and demo must be honest that history dates are simulated; the answers are real.

### 1.4 Decisions already made — do not re-ask

| Topic | Decision |
|---|---|
| Database | **SQLite** (better-sqlite3, WAL mode). No Supabase, no auth — single-tenant demo. |
| Frontend | **Next.js (App Router) + Tailwind + shadcn/ui + Recharts**, `basePath: "/geo"` |
| Hosting | Ubuntu VPS at **5.78.222.163**, `ssh root@5.78.222.163` (passwordless, ed25519 key already trusted). Repo at `/var/www/html/geo`, nginx reverse proxy `http://5.78.222.163/geo` → Node on port 3100. No domain, no HTTPS. pm2 for processes. Confirmed on the box: Node v22.22.1, nginx 1.28.3. |
| Repo | **public** GitHub repo `github.com/PalakSanghvi1/geo`. NEVER commit secrets — public repo. |
| Code flow | Write locally → push to GitHub → `./deploy.sh` pulls on the VPS. See §4.1. |
| Answer models | Claude **Sonnet 5**, OpenAI **GPT 5.6 Terra**, **Gemini 3.1 Pro** — all in web-search/grounded mode. Exact API model IDs must be **verified at build time** (see §6 Workstream A, Phase A1). All model IDs live in `src/lib/config.ts` with fallbacks. |
| Extraction model | Claude Haiku (`claude-haiku-4-5-20251001`), structured JSON output. |
| Slack | Free workspace created for demo. **Socket Mode** (no public URL needed). Daily digest + `/geo` slash command for on-demand runs. |
| Notion | Free workspace, **internal integration token** (no OAuth). Weekly report pages in a Notion database. Charts embedded via **QuickChart.io** image URLs (no image hosting needed). |
| Linear | Free workspace, **personal API key** (no OAuth), seeded with 6 fake Lemma roadmap projects (provided in §8). Weekly scan suggests queries/competitors; one-click "push recommendation to Linear as issue". |
| Scale | 15 base queries × 3 prompt texts each (original + 2 AI-generated variations) = **45 tracked prompts** × 3 models = **135 answer calls per run**. 7 backfill runs + live runs. |
| Sentiment | Included (it's free — same extraction call). Values −1 / 0 / +1 per mention. |
| Priority order if time runs short | 1) Core pipeline + dashboard, 2) Slack, 3) Linear, 4) Notion. Eval harness and run-status page are NOT cuttable (25% of rubric). |

### 1.5 Architecture at a glance

```
                    ┌──────────────────────── VPS (Ubuntu) ────────────────────────┐
                    │                                                              │
 Judges' browser ──▶│ nginx :80 /geo ──▶ pm2: geo-web (Next.js :3100)              │
                    │                        │  reads/writes                       │
                    │                        ▼                                     │
                    │                   data/geo.db (SQLite, WAL)                  │
                    │                        ▲                                     │
                    │ pm2: geo-worker ───────┘                                     │
                    │   ├─ node-cron: daily run (and demo-cadence run)             │
                    │   ├─ poller: run_requests table → executes runs              │
                    │   ├─ Slack bot (Socket Mode, outbound websocket)             │
                    │   ├─ weekly Notion publish job                               │
                    │   └─ weekly Linear scan job                                  │
                    └───────────┬──────────────────────────────────────────────────┘
                                ▼ outbound HTTPS only
              Anthropic API · OpenAI API · Gemini API · Slack · Notion · Linear · QuickChart
```

Two pm2 processes share the SQLite file (WAL makes this safe). The web app never calls LLMs directly; anything that triggers work inserts a row into `run_requests`, which the worker polls every 5 seconds. This gives one code path for scheduled, Slack-triggered, and dashboard-triggered runs.

---

## 2. Repository layout

```
geo/
├─ BUILD_PLAN.md              # this file
├─ DECISIONS.md               # log of on-the-fly decisions (each dev appends)
├─ README.md                  # quickstart + architecture summary (written in Phase 4)
├─ docs/
│  └─ reliability-brief.md    # submission artifact (written in Phase 4)
├─ .env.example               # every env var, no values
├─ .gitignore                 # includes .env, data/, node_modules/, .next/
├─ package.json               # single package; no monorepo tooling
├─ next.config.js             # basePath '/geo', output 'standalone'
├─ ecosystem.config.js        # pm2: geo-web + geo-worker
├─ deploy.sh                  # git pull, npm ci, build, migrate, pm2 restart
├─ data/                      # geo.db lives here (gitignored)
├─ scripts/
│  ├─ migrate.ts              # creates schema (idempotent)
│  ├─ seed.ts                 # brands, queries, generates variations via Haiku
│  ├─ backfill.ts             # runs pipeline N times with simulated past dates
│  ├─ seed-linear.ts          # creates 6 projects in the Linear workspace
│  ├─ export-evalset.ts       # samples 20 answers → eval/evalset.json for labeling
│  └─ eval.ts                 # runs extractor vs labels, prints precision/recall
├─ eval/
│  └─ evalset.json            # labeled answers (committed — it's demo data, no secrets)
├─ src/
│  ├─ lib/
│  │  ├─ config.ts            # model IDs + fallbacks, thresholds, brand config
│  │  ├─ db.ts                # better-sqlite3 singleton + typed query helpers
│  │  ├─ metrics.ts           # visibility/position/sentiment aggregation queries
│  │  └─ types.ts             # shared TS types (Answer, Mention, RunSummary…)
│  ├─ pipeline/
│  │  ├─ providers/
│  │  │  ├─ anthropic.ts      # askWithSearch(prompt) → {text, citations[]}
│  │  │  ├─ openai.ts
│  │  │  └─ gemini.ts
│  │  ├─ extract.ts           # Haiku structured extraction → mentions[]
│  │  ├─ runner.ts            # executeRun(runDate, trigger): fan-out, retries, status
│  │  └─ alerts.ts            # delta vs 7-day average, threshold logic
│  ├─ integrations/
│  │  ├─ slack.ts             # Socket Mode bot: digest, /geo command
│  │  ├─ notion.ts            # weekly report page builder
│  │  └─ linear.ts            # roadmap scan + issue creation
│  ├─ worker/
│  │  └─ index.ts             # cron schedules + run_requests poller + slack bot start
│  └─ app/                    # Next.js App Router
│     ├─ page.tsx             # Overview
│     ├─ prompts/page.tsx
│     ├─ answers/[id]/page.tsx
│     ├─ sources/page.tsx
│     ├─ runs/page.tsx
│     ├─ suggestions/page.tsx
│     └─ api/
│        ├─ overview/route.ts     # GET aggregates for dashboard
│        ├─ prompts/route.ts
│        ├─ answers/[id]/route.ts
│        ├─ sources/route.ts
│        ├─ runs/route.ts         # GET run list + live status
│        ├─ trigger/route.ts      # POST → insert run_request
│        └─ suggestions/route.ts  # GET list, POST approve/dismiss/push-to-linear
```

**Why a single package:** three devs, one day. Workstream boundaries are directory boundaries (`pipeline/` + `scripts/` = A, `app/` = B, `integrations/` + `worker/` = C). Shared files (`lib/`, this plan, schema) are owned by Dev A after Phase 0 — B and C request changes rather than editing them, except as noted.

---

## 3. Database schema (frozen after Phase 0)

Dev A creates this in `scripts/migrate.ts` exactly as written. B and C code against it from the start. Any change after Phase 0 must be coordinated in the team channel and applied only by Dev A.

```sql
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0,       -- 1 = Lemma
  aliases TEXT NOT NULL DEFAULT '[]'        -- JSON array of alternate spellings
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  parent_id INTEGER REFERENCES queries(id), -- NULL = base query; set = variation
  tag TEXT,                                  -- e.g. 'comparison', 'howto', 'category'
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  run_date TEXT NOT NULL,                    -- 'YYYY-MM-DD' (simulated for backfill)
  trigger TEXT NOT NULL,                     -- 'scheduled' | 'manual' | 'backfill'
  status TEXT NOT NULL DEFAULT 'running',    -- 'running' | 'complete' | 'partial' | 'failed'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  total_calls INTEGER NOT NULL DEFAULT 0,
  ok_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  query_id INTEGER NOT NULL REFERENCES queries(id),
  provider TEXT NOT NULL,                    -- 'anthropic' | 'openai' | 'gemini'
  model_id TEXT NOT NULL,                    -- exact model used (incl. fallback)
  status TEXT NOT NULL,                      -- 'ok' | 'error'
  answer_text TEXT,
  citations TEXT NOT NULL DEFAULT '[]',      -- JSON [{url, title?}]
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  position INTEGER NOT NULL,                 -- 1 = first brand named in the answer
  sentiment INTEGER NOT NULL DEFAULT 0,      -- -1 | 0 | 1
  quote TEXT                                 -- short supporting snippet
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                        -- 'query' | 'competitor'
  text TEXT NOT NULL,
  rationale TEXT NOT NULL,                   -- e.g. 'Linear project: Voice agent tracing'
  source TEXT NOT NULL DEFAULT 'linear',
  status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'approved' | 'dismissed'
  linear_issue_id TEXT,                      -- set if pushed to Linear
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_requests (
  id INTEGER PRIMARY KEY,
  requested_by TEXT NOT NULL,                -- 'slack:<user>' | 'dashboard' | 'cron'
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'picked_up' | 'done' | 'failed'
  run_id INTEGER REFERENCES runs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answers_run ON answers(run_id);
CREATE INDEX IF NOT EXISTS idx_mentions_answer ON mentions(answer_id);
CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(run_date);
```

**Metric definitions (implement in `src/lib/metrics.ts`, use everywhere — dashboard, Slack, Notion must agree):**

- **Visibility(brand, day[, provider])** = distinct ok answers that day (optionally per provider) containing ≥1 mention of brand ÷ total ok answers that day × 100.
- **Position(brand, day)** = AVG(position) over that brand's mentions that day (lower is better).
- **Sentiment(brand, day)** = AVG(sentiment) over mentions, displayed as −100..+100 (×100).
- **Delta/alert**: today's visibility minus the mean of the prior 7 days; alert if |delta| ≥ 5 points. Also alert on: first-ever appearance of an untracked brand name in ≥3 answers (surface in digest as "new competitor spotted" — extraction returns `other_brands`, see §6).
- When a run is `partial`, compute metrics over ok answers only and badge the day in the UI ("87% coverage").

### Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
SLACK_BOT_TOKEN=            # xoxb-…
SLACK_APP_TOKEN=            # xapp-… (Socket Mode)
SLACK_CHANNEL_ID=           # channel for digests
NOTION_TOKEN=               # ntn_… internal integration
NOTION_PARENT_PAGE_ID=
LINEAR_API_KEY=             # lin_api_…
DATABASE_PATH=./data/geo.db
PORT=3100
DEMO_CADENCE_MINUTES=0      # if >0, worker also runs every N minutes (demo mode)
```

---

## 4. Git workflow (all three devs)

### 4.1 Where work happens — local → GitHub → VPS

**Nobody edits code on the VPS.** All three devs work in a local clone on their own
machine. GitHub is the only thing that moves code between machines, and the VPS is a
pull-only consumer of `main`:

```
Dev A laptop ┐
Dev B laptop ├─ push branch ──▶ GitHub: PalakSanghvi1/geo ──┐
Dev C laptop ┘                  (main = always deployable)  │
                                                            │ git pull (./deploy.sh)
                                                            ▼
                                        VPS 5.78.222.163 : /var/www/html/geo
                                        nginx :80 /geo → pm2 geo-web :3100
                                                       → pm2 geo-worker
```

- Each dev's local clone is their working directory (Dev A's is `Desktop\GEO` on
  Windows). Run `npm run dev` locally against a **local** `data/geo.db` — your own
  scratch data, never the VPS database.
- **Push to GitHub at each milestone** (end of every phase and at every checkpoint).
  That push is what makes the work exist for the rest of the team.
- **Deploying is always: SSH to the VPS, `cd /var/www/html/geo`, `./deploy.sh`** —
  which does `git pull` + `npm ci` + migrate + build + `pm2 restart`. Never `scp`,
  never edit a file over SSH, never `git push` from the VPS. If something on the VPS
  looks wrong, fix it locally, push, and redeploy.
- The VPS has its own `.env` (created once by Dev A in Phase 0) and its own
  `data/geo.db`. Both are gitignored, so a deploy never touches either — which is why
  backfilled history on the VPS survives every redeploy.
- Only Dev A deploys, to keep `main` and the running instance in a known state.

### 4.2 Branches and checkpoints

- Repo: `github.com/PalakSanghvi1/geo`, public. Dev A creates it in Phase 0 and adds B and C as collaborators.
- Branches: `main` (deployable at all times, Dev A is merge owner), `ws-a`, `ws-b`, `ws-c`.
- **Push cadence: commit and push your branch at the end of every phase, and at every checkpoint time even if mid-task.** Small commits, present-tense messages. Never let more than ~40 minutes of work sit unpushed — a laptop problem must not kill a workstream.
- **Merge checkpoints (hard sync points, everyone pauses):**
  - **11:30** — Checkpoint 1: A merged (pipeline runs E2E, ≥1 provider); B merged (dashboard skeleton on mock/API data); C merged (Slack bot connects, responds to `/geo ping`).
  - **13:30** — Checkpoint 2: everything merged; **first deploy to VPS**; backfill running or done.
  - **15:00** — Feature freeze: final merges, deploy, live end-to-end test.
- Merge order at each checkpoint: A → main, then B rebases on main and merges, then C. Conflicts should be near-zero because of directory ownership; if one appears in `lib/`, Dev A resolves it.
- **Public repo hygiene:** `.env` is gitignored from the very first commit. Before every push, devs run `git diff --cached` mentally scanning for tokens. If a key is ever pushed, rotate it immediately (all providers allow instant rotation) and move on — do not spend hackathon time rewriting git history.

---

## 5. PHASE 0 — Bootstrap (9:30–10:05, all three devs in parallel)

### Dev A: VPS + repo + scaffold (the critical path)

1. **GitHub**: create public repo `geo` (via `gh repo create PalakSanghvi1/geo --public` or web UI). Add Dev B and Dev C as collaborators. Commit this `BUILD_PLAN.md`, an empty `DECISIONS.md`, and the four mockup PNGs into `docs/mockups/` (exported from the design canvas beforehand — they are Dev B's visual spec, see §7).
2. **Scaffold locally** (do NOT develop directly on the VPS):
   - `npx create-next-app@latest` (TypeScript, Tailwind, App Router, src dir). Set `next.config.js`: `basePath: '/geo'`, `output: 'standalone'`.
   - `npx shadcn@latest init`, then add components: `card button table badge tabs skeleton sonner`.
   - `npm i better-sqlite3 @anthropic-ai/sdk openai @google/genai @slack/bolt @notionhq/client node-cron recharts date-fns`
   - `npm i -D tsx @types/better-sqlite3`
   - Create the full directory skeleton from §2 with stub files that compile. Create `src/lib/db.ts` (better-sqlite3, `PRAGMA journal_mode=WAL`), `scripts/migrate.ts` with the exact schema from §3, `src/lib/config.ts`, `src/lib/types.ts`, `src/lib/metrics.ts` with typed function signatures (implementations may be TODO).
   - `package.json` scripts: `dev`, `build`, `start` (PORT 3100), `worker` (`tsx src/worker/index.ts`), `migrate`, `seed`, `backfill`, `seed-linear`, `export-evalset`, `eval`.
   - Commit and push to `main`. **Announce in team channel: "scaffold pushed" — this unblocks B and C.** Target: by 9:55.
3. **VPS setup** (SSH in; do this after the push, it's not blocking anyone):
   ```bash
   sudo apt update && sudo apt install -y build-essential python3 sqlite3
   sudo npm i -g pm2
   cd /var/www/html && git clone https://github.com/PalakSanghvi1/geo geo && cd geo
   cp .env.example .env    # then fill values as keys arrive from Dev B
   npm ci && npm run migrate
   ```
   **This box is shared.** `/var/www/html` is a live PHP staging portal with its own git
   repo and its own `.env` — our app lives entirely inside `/var/www/html/geo` and must
   never touch the parent directory, its `.env`, or its nginx rules beyond adding one
   location block.
4. **nginx**: the site is served by `/etc/nginx/sites-enabled/cape-fear-staging`, whose
   `server { listen 80 default_server; … }` block contains **regex** deny rules (e.g.
   `location ~* \.(md|sh|…)$`) and `^~` prefix denies for `/data/` and `/docs/`. A plain
   `location /geo` would lose to those regexes, so use the `^~` form, which outranks them.
   Back the file up first, add the block inside that `server { … }`, then
   `nginx -t && systemctl reload nginx` — **never reload without a passing `nginx -t`**,
   a bad config takes the existing portal down too:
   ```nginx
   location ^~ /geo {
     proxy_pass http://127.0.0.1:3100;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection 'upgrade';
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_cache_bypass $http_upgrade;
   }
   ```
   (Next.js has `basePath: '/geo'`, so pass the path through unchanged — no trailing-slash
   rewrite.) Confirm port 80 is reachable from outside (`ufw status`; allow 'Nginx Full' or
   80 if needed).
5. **pm2**: `ecosystem.config.js` defining `geo-web` (`npm run start`) and `geo-worker` (`npm run worker`). `pm2 start ecosystem.config.js && pm2 save && pm2 startup` (run the printed command). It's fine that both processes are mostly stubs right now.
6. **deploy.sh** (committed): `git pull && npm ci && npm run build && npm run migrate && pm2 restart geo-web geo-worker`. From here on, deploying = `ssh` + `./deploy.sh`.
7. Verify `http://5.78.222.163/geo` serves the Next.js default page. Announce "VPS live".

### Dev B: accounts & keys (then wait for scaffold push)

1. Create/collect API keys: **Anthropic**, **OpenAI**, **Gemini** (Google AI Studio). Put ~$25 credit on each where needed. Send keys to Dev A through a private channel (password manager share or DM — never the repo).
2. While waiting for scaffold: read §7 (your workstream), sketch the Overview page layout on paper.
3. Pull `main` as soon as A announces; branch `ws-b`.

### Dev C: Slack + Notion + Linear workspaces (then wait for scaffold push)

1. **Slack**: create a free workspace (e.g. `geo-hackathon`). Then at api.slack.com/apps → *Create New App* → from scratch:
   - **Socket Mode**: enable; generate an **app-level token** with scope `connections:write` → this is `SLACK_APP_TOKEN`.
   - **OAuth & Permissions** → bot token scopes: `chat:write`, `commands`, `app_mentions:read`. Install to workspace → `SLACK_BOT_TOKEN`.
   - **Slash Commands**: create `/geo`. With Socket Mode on, the request URL field is not used.
   - Create channel `#geo`, invite the bot (`/invite @GEO`), note the channel ID → `SLACK_CHANNEL_ID`.
2. **Notion**: create a free workspace. notion.so/profile/integrations → new **internal** integration → `NOTION_TOKEN`. Create a page **"GEO Reports"**; via page `•••` menu → Connections → add the integration. Copy the page ID from its URL (32-hex tail) → `NOTION_PARENT_PAGE_ID`.
3. **Linear**: create a free workspace. Settings → Security & access → **Personal API keys** → `LINEAR_API_KEY`. (Projects get seeded by script in Phase C2 — don't create them by hand.)
4. Send all tokens to Dev A privately for the VPS `.env`; keep copies in your local `.env`.
5. Pull `main`; branch `ws-c`.

---

## 6. WORKSTREAM A — Core pipeline, backfill, evals (Dev A)

**Owns:** `src/pipeline/`, `scripts/`, `src/lib/` (shared), VPS + deploys, merges to `main`.

### Phase A1 (10:05–11:30): providers + runner, one provider fully working

1. **Verify model IDs (do this first, ~10 min).** In `src/lib/config.ts` define:
   ```ts
   export const ANSWER_MODELS = [
     { provider: 'anthropic', primary: '<verified Sonnet 5 id>',  fallback: 'claude-sonnet-4-5' },
     { provider: 'openai',    primary: '<verified GPT 5.6 Terra id>', fallback: '<best available search-capable GPT id>' },
     { provider: 'gemini',    primary: '<verified Gemini 3.1 Pro id>', fallback: 'gemini-2.5-pro' },
   ];
   export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
   ```
   Verify by listing models from each API (`GET /v1/models` for Anthropic and OpenAI; `models.list` for Gemini) and/or current provider docs. "GPT 5.6 Terra" and "Gemini 3.1 Pro" are the human names — find the exact API IDs; if an ID can't be confirmed in 10 minutes, ship the fallback and record it in `DECISIONS.md`. The runner must auto-fall-back at call time on a model-not-found error.
2. **Providers** — each exports `askWithSearch(prompt: string): Promise<{text, citations, modelId, latencyMs}>`:
   - `anthropic.ts`: Messages API with the **server web search tool** (check current docs for the exact tool type string, e.g. `web_search_20250305` or newer; max_uses 3). Collect citations from response content blocks. `max_tokens: 1500`.
   - `openai.ts`: **Responses API** with `tools: [{ type: 'web_search' }]`. Collect `url_citation` annotations.
   - `gemini.ts`: `@google/genai` with `tools: [{ googleSearch: {} }]`. Citations from `groundingMetadata.groundingChunks`.
   - System/prompt framing: send the user query as-is; no system prompt steering ("answer as you would for a normal user"). Temperature default.
3. **Extraction** (`extract.ts`): one Haiku call per answer. Input: answer text + the brand list with aliases. Force JSON via a tool/structured output. Output shape:
   ```json
   { "mentions": [ { "brand": "<name from provided list>", "order": 1, "sentiment": 1, "quote": "…" } ],
     "other_brands": ["<names present but not in the list>"] }
   ```
   Rules for the extraction prompt: match aliases and possessives; `order` is by first appearance among *detected list brands*; sentiment reflects only what this answer says about that brand (−1/0/+1); `other_brands` = product/company names in the same category not on the list (used for "new competitor spotted"). Store `other_brands` in `DECISIONS.md`-documented place: simplest is a JSON column added NOW to `answers` (`other_brands TEXT DEFAULT '[]'`) — add it to the §3 schema before first migrate, it's pre-freeze.
4. **Runner** (`runner.ts`) — `executeRun(runDate, trigger)`:
   - Creates the `runs` row; builds job list = active prompts × ANSWER_MODELS (135 jobs).
   - Concurrency: **4 per provider** (12 total). Per call: timeout 90 s, **2 retries** with exponential backoff (2 s, 8 s) on timeout/429/5xx; on model-not-found switch to fallback ID and retry immediately.
   - Each job: `askWithSearch` → insert `answers` row (status ok/error) → if ok, `extract` → insert `mentions`. Extraction failures retry once, then mark the answer `status='ok'` with zero mentions and `error='extraction_failed'` (never lose the answer text).
   - Update `runs.ok_calls/failed_calls` as jobs complete (this powers the live run-status page). Finish: `complete` if failures = 0, `partial` if some, `failed` if all.
   - A run must **never throw**; every failure is a row, not a crash.
5. **Seed** (`seed.ts`): insert the 10 brands (with aliases, e.g. Weights & Biases → ["W&B", "Weave", "wandb"]; Datadog → ["Datadog LLM Observability"]), and 15 base queries. Use these (tags in brackets):
   1. What are the best production monitoring tools for AI agents? [category]
   2. How do I monitor my AI agent for failures in production? [howto]
   3. LangSmith vs Langfuse vs Lemma — which should I use? [comparison]
   4. Best LLM observability platforms in 2026 [category]
   5. What tools catch silent failures in AI agents? [category]
   6. How do teams evaluate AI agent reliability in production? [howto]
   7. Open source vs hosted LLM observability — what do you recommend? [comparison]
   8. What's the easiest way to add tracing to an AI agent? [howto]
   9. Alternatives to LangSmith for agent monitoring [comparison]
   10. Which AI agent monitoring tool has the best Slack alerting? [feature]
   11. Tools for debugging multi-step agent workflows [category]
   12. How do I know if my customer support AI agent is making mistakes? [howto]
   13. Best observability stack for a YC startup building AI agents [category]
   14. What is AI agent evaluation and which platforms do it? [category]
   15. Datadog vs specialized AI agent monitoring tools [comparison]
   Then generate 2 variations per base query with Haiku ("rephrase as a different user would ask; same intent, different wording") → 45 prompts total. Print them for a human sanity scan.
6. **Smoke test**: `executeRun(today, 'manual')` with **queries limited to 3** via a `--limit` flag. Verify answers, citations, and mentions land in the DB. Then push, merge to `main` at Checkpoint 1.

### Phase A2 (11:30–13:30): all providers + backfill + API routes for B

1. Finish/harden all three providers (A1 may have completed only Anthropic).
2. Implement `src/lib/metrics.ts` fully (visibility/position/sentiment/day series, per-provider splits, source aggregation from `answers.citations` grouped by domain, deltas vs 7-day average). Implement the read API routes in `src/app/api/` **against the shapes agreed in §7** — B is building UI on these.
3. **Backfill** (`backfill.ts`): for day offsets −7…−1: `executeRun(date, 'backfill')`, sequential. **Start it by ~12:30** on the VPS (`nohup npm run backfill &` or a pm2 one-off) — 7 runs × ~6–8 min ≈ 50–60 min, ~$15–25. While it runs, keep coding locally.
   - After it completes, run once more for **today** with trigger `scheduled` so the dashboard has a current day.
4. Deploy at Checkpoint 2 (13:30): merge all, `./deploy.sh`, verify dashboard shows real backfilled data at `http://5.78.222.163/geo`.

### Phase A3 (13:30–15:00): evals + reliability polish

1. **Eval harness** (the 25% line item):
   - `export-evalset.ts`: sample 20 ok answers stratified across providers → `eval/evalset.json`: `[{answer_id, answer_text, expected: null}]`.
   - **Hand-label them** (~25 min, split among whoever is free): fill `expected` with the mentioned brands in order (+sentiment). Human labels, not LLM labels — say so in the brief.
   - `eval.ts`: re-run `extract()` on each labeled answer; compute **mention precision/recall** (brand detected vs expected), **position exact-match %**, **sentiment agreement %**. Print a table; also write `eval/results.json`. If precision or recall < 0.9, spend up to 30 min improving the extraction prompt and re-run (this iteration loop is itself a demo/brief talking point).
2. Reliability polish: ensure `partial` runs render correctly everywhere; kill a provider key locally and confirm a run completes as `partial` with the other two providers (screenshot this for the brief); add `/geo/api/runs` including live in-flight counts.
3. Support `DEMO_CADENCE_MINUTES` in the worker (e.g. 20) so fresh runs land during judging without manual triggers.

### Phase A4 (15:00–16:00): freeze support

Final merge + deploy at 15:00. Trigger one live `manual` run for the demo recording. Then write `docs/reliability-brief.md` (§10) and `README.md` while B records the demo.

---

## 7. WORKSTREAM B — Dashboard (Dev B)

**Design reference:** mockups for all four screens (Overview, Answer Detail, Runs, Suggestions) exist as PNG exports in `docs/mockups/` in this repo — Dev A commits them in Phase 0. Match them: minimal light theme, page background `#F6F5F2`, cards `#FCFCFB` with hairline borders (`rgba(11,11,11,0.08)`, radius 10px, no shadows), 212px sidebar, Instrument Sans for UI + IBM Plex Mono for overline labels/numeric chips (Google Fonts), a single blue accent `#2A78D6` reserved for the self-brand and primary actions, chart series colors `#2a78d6 / #eb6834 / #1baf7a / #eda100 / #e87ba4`, deltas in `#006300` (up) / `#b3402f` (down).

**Owns:** `src/app/` (pages + components). Codes against the API route shapes below; until A's routes return real data (Checkpoint 2), build against a mock module `src/lib/mock.ts` behind a `USE_MOCK` flag you can flip off.

**API contracts (agree with A in Phase 0; shapes frozen like the schema):**

- `GET /api/overview?days=14&provider=all` → `{ series: [{date, brand, visibility}], scoreboard: [{brand, isSelf, visibility, delta7, avgPosition, sentiment}], coverage: [{date, okPct}] }`
- `GET /api/prompts` → per-prompt: text, tag, isVariation, visibility (self), top-3 brands, last answer ids per provider
- `GET /api/answers/:id` → full answer text, provider, model, citations, mentions
- `GET /api/sources?days=14` → `[{domain, citationCount, topBrand, urls: [{url, count}]}]`
- `GET /api/runs` → `[{id, run_date, trigger, status, ok_calls, failed_calls, total_calls, started_at, finished_at}]` (poll every 5 s on the Runs page)
- `POST /api/trigger` `{note}` → inserts `run_requests` row
- `GET/POST /api/suggestions` (list; approve → also inserts into `queries`/`brands`; dismiss; push-to-linear → calls C's `integrations/linear.ts` `createIssue`)

### Phase B1 (10:05–11:30): skeleton + Overview

- Layout: left sidebar (Overview · Prompts · Sources · Runs · Suggestions), header with brand name "Lemma — AI Visibility", provider filter (All/Claude/GPT/Gemini), date-range select (7/14 days). shadcn components; dark theme is fine to hardcode; keep it clean — judges see this for two minutes.
- **Overview**: hero stat cards (Visibility today + Δ7d arrow, Avg position, Sentiment, Coverage %), a Recharts multi-line visibility chart (Lemma bold, competitors muted; legend toggles), and a competitor scoreboard table sorted by visibility with delta badges. This page is 70% of demo screen time — make it the polish priority.
- Build on mocks; wire real endpoints as A lands them. Merge skeleton at Checkpoint 1.

### Phase B2 (11:30–13:30): Prompts, Answer detail, Runs

- **Prompts**: table with tag filter; variations grouped under their base query (indent/badge). Row → answers.
- **Answer detail**: raw answer with brand mentions highlighted (mark Lemma in green, competitors in amber, using the `quote`/name offsets — simple string match on brand + aliases is fine), citations list with favicons (`https://www.google.com/s2/favicons?domain=…`), provider/model/latency metadata.
- **Runs**: table with live-updating status ("Run #12 · manual · 87/135 complete · 2 failed"), coverage bars, and a **"Run now"** button → `POST /api/trigger` → toast → row appears. This page is the reliability story made visible — include per-provider ok/fail split if data allows.
- Merge + first real-data deploy at Checkpoint 2. Walk the whole app against backfilled data; fix what looks wrong with real answer lengths.

### Phase B3 (13:30–15:00): Sources, Suggestions, polish

- **Sources**: top cited domains (bar or table), expandable to URLs; badge domains that are competitor-owned (match against brand names).
- **Suggestions**: cards ("Track: *best voice agent monitoring tools* — because Linear project 'Voice agent tracing support'") with Approve / Dismiss / **Create Linear issue** buttons.
- Polish pass: loading skeletons, empty states, number formatting, the Overview chart annotated with a dotted "backfilled ↔ live" boundary line (honesty + a nice demo beat). Mobile is irrelevant; judges use a laptop.

### Phase B4 (15:00–16:00): demo

You own the **two-minute demo recording** (§10 script) after the 15:00 freeze — screen-record against the live VPS URL, one take is fine, narrate over it.

---

## 8. WORKSTREAM C — Integrations + worker (Dev C)

**Owns:** `src/integrations/`, `src/worker/`.

### Phase C1 (10:05–11:30): worker frame + Slack bot alive

1. **Worker** (`src/worker/index.ts`): starts Slack bot; `node-cron` for daily-run schedule (`0 9 * * *`) and weekly Notion/Linear jobs (stubs now); a 5-second poller on `run_requests` (`pending` → mark `picked_up` → call A's `executeRun` → mark `done`/`failed` → fire Slack completion message). Until A's runner is merged, call a stub that sleeps 10 s.
2. **Slack** (`@slack/bolt`, `socketMode: true`): 
   - `/geo ping` → "pong 🏓" (Checkpoint 1 proof).
   - `/geo run [note]` → insert `run_request` (requested_by `slack:<user>`), reply "🔎 Run queued — I'll post results here." On completion, post: visibility now vs yesterday, biggest mover, link `http://5.78.222.163/geo/runs`.
   - `/geo status` → today's numbers one-liner.
3. Merge at Checkpoint 1.

### Phase C2 (11:30–13:30): digest + Linear seed + scan

1. **Daily digest** (`buildDigest(date)` in `slack.ts`, Block Kit): header with date; Lemma visibility + Δ vs 7-day avg with ▲/▼; notable events (crossed a competitor, new competitor spotted from `other_brands` aggregation, provider divergence like "GPT mentions you 2× more than Gemini"); top 3 competitors one-liner; coverage line ("135/135 answers collected ✅"); dashboard link. Wire to the daily cron AND post one automatically when any `manual` run completes.
2. **Seed Linear** (`scripts/seed-linear.ts`, GraphQL `https://api.linear.app/graphql`, header `Authorization: <LINEAR_API_KEY>`): create 6 projects with descriptions:
   - *Voice agent tracing support* — "Extend tracing SDK to capture voice agent sessions: STT/TTS spans, latency, interruption handling."
   - *Self-serve onboarding* — "PLG motion: signup without sales call, first-trace-in-10-minutes flow, starter tier pricing."
   - *SOC 2 Type II automation* — "Continuous compliance evidence collection; enterprise security questionnaire portal."
   - *Computer-use agent monitoring* — "Trace and replay browser/desktop automation agents; screenshot diffing on failures."
   - *Eval marketplace* — "Community-contributed eval templates for common agent failure modes."
   - *n8n and Zapier integration* — "Let no-code builders pipe Lemma alerts into their automation workflows."
3. **Linear scan** (`linear.ts`): fetch projects (+descriptions, states); one Sonnet call with: company context (Lemma one-liner), current query list, current competitor list, the projects. Ask for ≤5 suggestions, each `{kind, text, rationale}` where rationale names the project. Insert into `suggestions` (skip duplicates by text). Wire to weekly cron + expose `runLinearScan()` for a dashboard/manual trigger. Also implement `createIssue(suggestion)` → Linear issue titled "GEO: <text>" with rationale in the body (used by B's Suggestions page).
4. Merge at Checkpoint 2.

### Phase C3 (13:30–15:00): Notion weekly report

1. `notion.ts` — `publishWeeklyReport(weekEndingDate)`: creates a child page under `NOTION_PARENT_PAGE_ID` titled "Lemma AI Visibility — Week ending <date>". Blocks:
   - Callout: headline stat ("Visibility 41% ▲4 pts WoW").
   - **Chart image**: QuickChart URL — build a Chart.js config (line chart, 14-day visibility, Lemma + top 4 competitors), `encodeURIComponent` the JSON into `https://quickchart.io/chart?w=800&h=400&c=…`, embed as external image block. No hosting needed.
   - Table: competitor scoreboard.
   - Bulleted: top cited sources; notable events.
   - Paragraphs: 3 narrative takeaways written by one Sonnet call over the week's aggregates.
2. Wire to weekly cron; run it once now against backfill data so a real page exists for the demo. Test the QuickChart URL renders before embedding.
3. If time remains: end-to-end rehearsal of the Slack story (`/geo run` on the VPS → watch run complete → digest posts) and fix rough edges.

### Phase C4 (15:00–16:00): submission support

After freeze: verify pm2 processes healthy (`pm2 status`, `pm2 logs`), Slack/Notion/Linear all demoable, help A with the brief (write the integrations section).

---

## 9. Timeline summary

| Time | Dev A | Dev B | Dev C |
|---|---|---|---|
| 9:30–10:05 | Repo + scaffold + VPS + nginx + pm2 | API keys → A; read plan | Slack/Notion/Linear workspaces + tokens → A |
| 10:05–11:30 | Providers, extraction, runner (1 provider E2E) | Layout + Overview on mocks | Worker frame, Slack bot, `/geo` commands |
| **11:30** | **Checkpoint 1: merge all → main** | | |
| 11:30–13:30 | All providers, metrics, API routes; **backfill starts ~12:30** | Prompts, Answer detail, Runs pages | Digest, Linear seed + scan, createIssue |
| **13:30** | **Checkpoint 2: merge, DEPLOY to VPS, real data in dashboard** | | |
| 13:30–15:00 | Eval harness + labeling, reliability polish | Sources, Suggestions, polish | Notion weekly report, rehearsal |
| **15:00** | **Freeze: final merge + deploy + live run** | | |
| 15:00–16:00 | Reliability brief + README | **Record 2-min demo** | pm2/integration health, brief help |

Everyone labels eval answers together ~13:45 if A is behind.

---

## 10. Submission artifacts

### Two-minute demo script (Dev B records; target 115 seconds)

1. (0:00) "AI answers are the new search results. This is GEO — it tracks how AI models talk about your brand. We're tracking Lemma, an AI-agent-observability startup, against 9 competitors." — Overview page: trend chart, scoreboard.
2. (0:25) "Every day we run 45 real customer questions across Claude, GPT, and Gemini with live web search — here's an actual answer, with every brand mention extracted, positioned, and sentiment-scored, plus the sources the model cited." — Answer detail, then Sources.
3. (0:50) "It's built for reliability: live run status, automatic retries, and if a provider dies mid-run we degrade to partial coverage instead of failing. We eval our extraction against a hand-labeled set — 9X% precision." — Runs page, eval numbers.
4. (1:10) "News just dropped? Trigger a run from Slack." — `/geo run`, digest arrives. "Weekly reports auto-publish to Notion." — flash the Notion page.
5. (1:30) "And the part nobody else does: GEO reads our Linear roadmap and suggests what to track next — we're shipping voice-agent tracing, so it proposes tracking 'best voice agent monitoring tools', and can file the work back into Linear." — Suggestions page → create issue → issue in Linear.
6. (1:50) "Roadmap in, visibility out, alerts where you work. That's GEO." (Disclose on-screen caption during the chart shot: "history backfilled from real runs executed today".)

### Reliability brief (`docs/reliability-brief.md`, ~1 page)

Sections: **System** (architecture diagram from §1.5, stack, single-code-path for scheduled/manual/Slack runs); **Failure handling** (retry policy, timeouts, model-ID fallbacks, partial-run semantics, never-crash runner, WAL concurrency, pm2 restart-on-crash); **Evaluation** (harness design, 20 hand-labeled answers, precision/recall/position/sentiment numbers, what we changed after the first eval pass); **Honesty notes** (historical dates simulated via same-day real runs; single-tenant demo; extraction is LLM-based and imperfect — quantified by the eval); **What we'd do next** (real daily cadence, GA4 referral correlation, multi-tenant auth).

---

## 11. Risks & fallbacks

| Risk | Mitigation / fallback |
|---|---|
| A "verified" model ID rejects at runtime | Automatic fallback IDs in config; runner swaps on model-not-found. |
| One provider slow/rate-limited during backfill | Per-provider concurrency caps; partial runs are first-class; demo works with 2 providers. |
| Backfill overruns | Cut to 5 backfill days (`BACKFILL_DAYS`), or cut variations to 1 per query (30 prompts). Decide by 13:15. |
| Slack Socket Mode flakes on VPS | Bot auto-reconnects (Bolt default); worst case, demo Slack from a locally-run worker pointed at a copy of the DB. |
| Notion/Linear time crunch | Priority order stands: Notion is the first cut, then Linear scan (keep seeded projects visible and *narrate* the feature over the Suggestions UI with pre-inserted rows). |
| VPS dies during judging | Repo runs locally with `npm run dev` + local worker; keep local .env ready. Record the demo at 15:15, not 15:55. |
| Secret pushed to public repo | Rotate the key immediately; note it; move on. |
| better-sqlite3 build fails on VPS | build-essential installed in Phase 0; fallback `npm i sqlite3` alternative not needed in practice — prebuilt binaries exist for Node 22. |

---

## 12. Definition of done (check at 15:00)

- [ ] `http://5.78.222.163/geo` shows Overview with ≥8 days of data (7 backfill + today) for 10 brands across 3 providers
- [ ] A live `manual` run completes end-to-end from both the dashboard button and `/geo run`
- [ ] Runs page shows a partial run somewhere in history (or a screenshot of the kill-a-provider test exists for the brief)
- [ ] `npm run eval` prints precision/recall from ≥20 hand-labeled answers; numbers are in the brief
- [ ] Slack digest posted in `#geo`; Notion weekly page exists; ≥3 Linear-derived suggestions visible; ≥1 pushed to Linear as an issue
- [ ] `main` is green, deployed, tagged `v0.1.0`; README quickstart works; reliability brief committed
- [ ] Demo video recorded
