# GEO — System & Reliability Brief

GEO measures how often AI assistants mention a brand when real customers ask real
questions. Every number it shows is a percentage derived from a batch of live API calls
to three providers with web search enabled. That makes reliability a correctness problem,
not a comfort feature: a run that dies halfway does not merely lose data, it changes the
denominator of a percentage and silently reports a number that is wrong rather than
missing. This brief describes the system, what happens when each part of it fails, and
how the measurement instrument itself is evaluated.

---

## 1. System

```
                ┌──────────────────────── VPS (Ubuntu, 5.78.222.163) ─────────────────────┐
                │                                                                         │
 judge's        │  nginx :80                                                              │
 browser  ─────▶│  location ^~ /geo ──▶ pm2: geo-web   (Next.js 16, basePath /geo, :3100)  │
                │                              │                                          │
                │                    POST /api/trigger inserts a row; never calls an LLM   │
                │                              ▼                                          │
                │                   data/geo.db  (SQLite, WAL, busy_timeout 5s)           │
                │                              ▲                                          │
                │  pm2: geo-worker ────────────┘                                          │
                │    ├─ node-cron        daily run                                        │
                │    ├─ poller           run_requests: pending → picked_up → done         │
                │    └─ Slack bot        Socket Mode (outbound websocket, no inbound URL)  │
                └───────────────┬─────────────────────────────────────────────────────────┘
                                ▼ outbound HTTPS only
            Anthropic · OpenAI · Gemini   (answers, web search on)
            Anthropic Haiku               (extraction)
```

Two pm2 processes share one SQLite file. WAL mode is what makes that safe
(`src/lib/db.ts`), together with `busy_timeout = 5000` so a writer waits for a lock
instead of throwing, `synchronous = NORMAL`, and `foreign_keys = ON`.

**One code path for every run.** The web app never calls an LLM. `POST /api/trigger`
inserts a `run_requests` row and returns 201 (`src/app/api/trigger/route.ts`); the worker
polls that table and calls `executeRun()`. Scheduled runs, the dashboard "Run now"
button, and the Slack `/geo run` command therefore exercise the same executor, the same
retry policy and the same partial-run accounting. There is no "demo path" that behaves
differently from the real one.

nginx uses `location ^~ /geo` rather than a plain prefix: the shared server block on this
box carries regex deny rules (`location ~* \.(md|sh|…)$`) that would otherwise outrank a
plain prefix match and serve a 403 instead of the app.

**Implementation status (honest).** The runner, the three provider adapters, the
extractor, the metrics layer, the read/trigger API routes and the eval harness are
implemented. `src/worker/index.ts` now replaces the Phase-0 placeholder: the cron
schedule, the `run_requests` poller and the Slack Socket Mode bot are in the repo, as is
`src/integrations/` (Slack, Notion, Linear, QuickChart). Runs can therefore be driven by
the poller, by `npm run run-once` or by `npm run backfill` — all of which call the same
`executeRun()`.

One gap remains at the seam between workstreams: **no API route pushes a suggestion to
Linear**. `createIssue()` is implemented and exported, and
`src/app/api/suggestions/route.ts` handles approve/dismiss, but nothing connects them, so
the "push a recommendation back to Linear" step has no HTTP entry point yet.

---

## 2. Failure handling

All tuning lives in one block, `RUNNER` in `src/lib/config.ts`:

| Setting | Value | Why |
|---|---|---|
| `concurrencyPerProvider` | 4 (three independent pools, ≤12 in flight) | One throttled provider slows only itself |
| `answerTimeoutMs` | 90 000 ms | Search-grounded answers are slow; a hung socket must not hold a lane |
| `maxRetries` | 2 (so up to 3 attempts) | Enough for a transient 429/5xx without stretching a 135-call run |
| `backoffMs` | `[2000, 8000]` | Two waits, ~10 s worst case per call |
| `maxAnswerTokens` | 4000 | A truncated answer loses the brands named *last*, corrupting position and visibility rather than just shortening text |

**Retries live in exactly one place.** Both vendor SDKs are constructed with
`maxRetries: 0` (`providers/anthropic.ts`, `providers/openai.ts`) so the SDK cannot
silently retry underneath the policy in `src/pipeline/providers/index.ts`. Gemini is a raw
`fetch` with an `AbortController` on the same 90 s budget.

**What is retried.** `isRetryable()` returns true for HTTP 429, any 5xx, and errors with
no status whose message matches timeout / aborted / `ECONNRESET` / `ETIMEDOUT` /
`EAI_AGAIN` / `fetch failed` / `socket hang up`. Any other explicit status — i.e. a 4xx
we caused — is not retried; re-sending a malformed request only burns the budget.

**Cross-tier model fallback instead of a backoff.** Each provider has a primary and a
fallback model id. Two conditions trigger a swap, and both swap *immediately with no
sleep*, decrementing the attempt counter so the swap does not consume a retry:

1. the primary id is rejected (`isUnknownModel`: a 404, or a 400 whose message actually
   talks about the model), and
2. **HTTP 429.** Quota on these APIs is per model tier, so a rate-limited preview/Pro
   model says nothing about a Flash-tier model. Sleeping 2 s and 8 s against a model with
   zero remaining quota would spend the entire retry budget guaranteed to fail, and the
   call would end as an error row. Swapping tier is the only recovery that can work.

This is not hypothetical: `gemini-3.1-pro-preview` has no free-tier quota on this account,
so the configured fallback is `gemini-3.5-flash`, which does (see the comment in
`config.ts` and the Gemini entries in `DECISIONS.md`). The model actually used is stored
per answer in `answers.model_id`, so a day served partly by a fallback model is visible in
the data rather than hidden.

**Provider-specific failure shapes that do not look like failures.** Two are handled in
`providers/anthropic.ts` and both would otherwise corrupt answers silently rather than
raise:

- A failed server-side web search returns **HTTP 200** with a `web_search_tool_result`
  block whose `content` is an error *object*, not the usual *array* of results. Indexing
  it blindly yields `undefined`, never an exception — so the collector checks
  `Array.isArray(content)` and skips non-arrays.
- `stop_reason: "pause_turn"` means the model paused mid-search and expects its own
  content echoed back to resume. Treating that as a finished answer truncates the
  response. The adapter resumes up to 3 times.
- Thinking is set to `adaptive`, not disabled. With thinking off, the model narrates its
  own search into the visible answer ("the results are JSON strings…") and that narration
  would be scored as if it were the answer. Adaptive keeps the reasoning in `thinking`
  blocks, which are dropped.

**A run never throws.** This is the central contract of `src/pipeline/runner.ts`. Every
failure becomes a row: an `answers` row with `status='error'` and a truncated error
message, and a run finalized as `partial`. Each provider pool lane catches around its
worker so one throw cannot kill a lane. The reason this matters is not tidiness —
visibility is *ok answers mentioning the brand ÷ all ok answers that day*. A crashed run
leaves a day whose denominator quietly shrank, which yields a plausible-looking percentage
computed over a biased subset. A recorded error yields a day that is honestly 87% covered.
Losing data is recoverable; publishing a wrong number is not.

**Extraction is a separate failure domain from collection.** The answer row is committed
before extraction is attempted. If the Haiku extraction call fails, the answer keeps
`status='ok'` with zero mentions and `answers.error` is set to
`extraction_failed: …`. The answer text is the expensive artefact — it cost a
search-grounded frontier-model call and cannot be reproduced later, because the web moved
— whereas extraction is cheap and can be re-run offline against stored text. Mentions are
written inside a transaction with the `other_brands` update, so an answer never ends up
half-extracted.

**Partial-run semantics, end to end.** `runs.ok_calls` / `failed_calls` are updated after
*every* completed job, so `GET /api/runs` shows live in-flight progress rather than a
result only at the end. A run finalizes as `complete` (0 failures), `partial` (some), or
`failed` (all). `src/lib/metrics.ts` then computes every metric over `status='ok'` answers
only and reports `coverage.okPct = ok ÷ attempted` as a separate series, so the UI can
badge a degraded day instead of quietly averaging it in. Metrics aggregate by `run_date`
across all runs on that date, which means a provider that was blocked at run time can be
topped up later (`npm run backfill -- --providers gemini --force`) and merges into the
same day rather than creating a competing one. `runExistsFor()` guards against
double-backfilling a date.

**Process level.** pm2 runs both apps with `autorestart: true` and `max_restarts: 20`, and
boot persistence is enabled (`pm2 startup systemd` + `pm2 save`, unit `pm2-root` enabled),
so a VPS reboot brings both processes back. `deploy.sh` is `git pull --ff-only` → `npm ci`
→ `npm run migrate` (idempotent) → `npm run build` → `pm2 restart --update-env` →
`pm2 save`; `.env` and `data/` are gitignored, so a deploy never touches credentials or
the collected history. `npm run status` prints counts, recent runs, the current scoreboard
and the top recent failure messages, so a bad demo can be diagnosed over SSH in one
command; `npm run smoke` exercises one real call per provider plus one extraction to tell
a pipeline fault from a provider outage.


### Integrations and the worker loop (Workstream C)

**The worker is the only thing that runs a run.** `src/worker/index.ts` polls
`run_requests` every 5 seconds. A pending row is claimed inside a SQLite transaction
(`SELECT … LIMIT 1` then `UPDATE … 'picked_up'`), so a restart mid-run, or a second
worker started by mistake, cannot execute the same request twice. An in-process guard
refuses to begin a second run while one is in flight — 135 answer calls already saturate
the provider budget, and two overlapping runs would corrupt the per-day coverage figures.

**The daily cron queues; it does not execute.** The 09:00 schedule inserts a
`run_requests` row exactly like the dashboard button and `/geo run`. That is what makes
the "one code path" claim above true for scheduled runs as well, rather than true for
everything except the path that actually runs every morning.

**Slack needs no inbound URL.** The bot runs in Socket Mode, an outbound websocket, so
nothing is exposed through nginx and no request-signing secret is in play. Bolt
reconnects on its own. The worker starts with Slack *disabled* rather than failing when
the tokens are absent, so a missing credential costs the digest, not the run loop.
`postToChannel` never throws and diagnoses the one failure that looks like a bug:
`not_in_channel` is reported as "run `/invite @geo` in that channel".

**One Socket Mode connection at a time.** Slack delivers each command to a single
connection, so a laptop worker running alongside the VPS worker makes slash commands
answer intermittently. This is an operational rule, not a code defect: stop the local
worker before a demo.

**Every number in Slack and Notion comes from `src/lib/metrics.ts`.** The digest and the
weekly report call `getOverview()`, `getSignals()` and `getSources()` and do nothing but
format the result. This is deliberate: a second implementation of "visibility" would let
the Slack digest and the dashboard disagree on screen during the demo, which reads as a
correctness failure whichever number is right.

**Run completions report per-provider coverage.** The Slack post carries the runner's own
`byProvider` counts (`anthropic 45/45 ✅ · openai 44/45 ⚠️`), so a degraded run announces
itself where the team already is, without anyone opening the dashboard.

**A weekly job cannot take the worker down.** Every cron callback is wrapped, and
`runLinearScan()`, `createIssue()` and `publishWeeklyReport()` never throw — missing
credentials, an API error or an empty database are logged and return `0` / `null`. The
Notion report degrades rather than aborting: if the narrative model call fails the page
publishes without its takeaways, and an empty database yields a shorter page instead of a
crash (Notion rejects a table with no rows).

**Two external limits worth recording.** Notion rejects any URL over 2000 characters, and
Notion's servers are what fetch the QuickChart trend image. Serialized as ordinary JSON
the specified chart — the tracked brand plus its top 4 competitors over 14 days — came to
~2500 characters and had to be silently trimmed to 2 competitor lines. Emitting the chart
config in QuickChart's JSON5 dialect (unquoted keys, single quotes, since
`encodeURIComponent` expands `"` to `%22` but leaves `'` alone) and rounding plotted
values to whole percent brings it to ~1870, so the chart specified is the chart published.
The report still steps down to 3, 2, 1 or no image if a future chart outgrows the budget.

**A structured-output failure mode we hit and fixed.** A `strict: true` tool schema whose
array holds bare strings is not reliable: one live Sonnet call in four returned
`{"takeaways": ["takeaways"]}` — the field name as the only element. Wrapping each item in
an object with a named field fixed it across eight consecutive runs, with a minimum-length
filter as a backstop. The same shape is worth applying to any forced-tool call that wants
a list of strings.

---

## 3. Evaluation

Visibility, position and sentiment are all downstream of one Haiku call in
`src/pipeline/extract.ts`. If that call is wrong, the dashboard is *confidently* wrong. So
the extractor is held to a number rather than to inspection.

Two design choices reduce the error the eval then has to measure: **positions are
recomputed, not trusted** — the model reports a `first_char_index` per brand and
`extract.ts` sorts by it and renumbers 1..N, because models are good at spotting brands
and unreliable at counting them; and **brand names are snapped to the canonical spelling**
from the roster (aliases included), with unrecognised names dropped, so a stray
"Langsmith" can never create a second brand in the database.

**Harness** (`scripts/eval.ts`, `eval/README.md`). `npm run export-evalset` samples real
`ok` answers out of the database into `eval/evalset.json`, dealt round-robin across
providers and stride-sampled across each provider's history so one model or one backfill
day cannot dominate; re-running preserves every existing label verbatim. A human fills in
`expected` — human labels, not LLM labels. `npm run eval` re-runs `extractMentions()` over
the labelled answers at concurrency 3 and writes `eval/results.json`.

The scoring unit is the **(answer, brand) pair**, micro-averaged over all labelled
answers. TP = brand predicted and labelled; FP = predicted but not labelled (a
hallucinated mention); FN = labelled but not predicted (a missed mention).

| Metric | Definition |
|---|---|
| Mention precision | `TP / (TP + FP)` — of the mentions we report, how many are real |
| Mention recall | `TP / (TP + FN)` — of the mentions that exist, how many we find |
| Mention F1 | `2PR / (P + R)` |
| Position accuracy | of the **TP** brands, the fraction whose predicted rank equals the labelled rank |
| Sentiment agreement | of the **TP** brands, the fraction whose predicted sentiment (−1/0/+1) equals the label |

Position and sentiment are conditioned on TP deliberately: a brand that was never detected
has no rank or sentiment to be right or wrong about, and folding it in would count the
same detection failure twice, once as a missed mention and again as a wrong position.
That would make a detection regression look like three regressions and obscure which part
of the instrument actually drifted.

Two properties keep the harness itself honest. A labelled brand that is not on the
`brands` roster can never be matched, so it is reported as a **labelling** bug
(`WARNING: … can never be matched`) instead of silently depressing recall. And a single
extraction API failure is recorded as a failed row and excluded from the metric
denominators rather than aborting the run or counting as a miss — one flaky call must not
depress the score of the other nineteen. Both scripts always exit 0: a bad score is
information, not a crash, and must never fail a deploy.

### Results — NOT YET SCORED

**No human labels exist yet, so the extractor has no measured score and this brief
contains no accuracy numbers.** As of writing, `eval/evalset.json` holds 6 sampled answers
(3 Anthropic, 3 OpenAI) with `expected: null` on every one, and `eval/results.json` has
not been generated. `npm run eval` currently prints its labelling instructions and exits.
Target is precision ≥ 0.90 and recall ≥ 0.90; the script prints PASS/FAIL against it.

<!-- TODO: fill from eval/results.json once eval/evalset.json is hand-labelled and `npm run eval` has been run. Do not populate this table by hand or from memory. -->

| Metric | Value | Target | Status |
|---|---|---|---|
| Mention precision | _not yet scored_ | 0.90 | — |
| Mention recall | _not yet scored_ | 0.90 | — |
| Mention F1 | _not yet scored_ | — | — |
| Position accuracy | _not yet scored_ | — | — |
| Sentiment agreement | _not yet scored_ | — | — |
| Answers labelled / scored | 0 of 6 sampled | ≥ 20 | — |

If precision or recall misses target, the loop is: read the per-answer breakdown
(`MISSED` / `HALLUCINATED` / `POSITION` / `SENTIMENT`), adjust the roster aliases or the
`SYSTEM` prompt in `src/pipeline/extract.ts`, and re-run against the **same** labelled
set. Whatever changed between passes belongs in this section.

---

## 4. Honesty notes

- **Most of the visible history is fabricated, and it is labelled as such.** Of the 90 days
  currently in the database, **2 are real and 88 are synthetic** (`npm run seed-synthetic`).
  Months of history cannot be collected in a one-day build, so it was generated. Provenance
  is carried in the data rather than in a disclaimer someone has to remember:
  - every fabricated run is tagged `trigger = 'synthetic'`, which the Runs page displays;
  - every fabricated answer body opens with `[SYNTHETIC — fabricated for trend history, not
    a model response]`, so clicking one says so itself;
  - the generator never overwrites a date that already has a real run.

  Trajectories are anchored to each brand's real measured visibility and real mean
  sentiment, so the fabricated past converges on the observed present rather than
  contradicting it — but it is invented, and the shape of the trend lines is not evidence
  of anything. Anyone presenting this must say the history is illustrative.
  `npm run seed-synthetic -- --purge --yes` removes all of it.
- **Source analysis is not fabricated.** Synthetic answers are written with **no citations
  at all**, so every domain and count on the Sources page comes from genuinely retrieved
  results. This was a deliberate constraint: a fabricated citation graph would corrupt the
  one analysis a user would most reasonably act on.
- **The real answers are real.** Every answer from a real run was collected live from
  Claude, GPT or Gemini with that provider's web search / grounding tool enabled, and is
  stored verbatim with its citations, latency and the exact model id used. Real days are
  identifiable by `trigger` — use one of those when demonstrating answer detail.
- **The dates are simulated.** Trend history is produced by `npm run backfill`, which runs
  the real pipeline repeatedly on one day and labels each run with a past `run_date`. A
  one-day build cannot wait a week for genuine daily history. Day-to-day variation in the
  charts therefore reflects real model and search variance, not the passage of time.
  Backfilled dates must never be presented as historical observations. The honesty note is
  in the source at the top of `scripts/backfill.ts`, not only in this brief.
- **Extraction is LLM-based and imperfect.** That is precisely why it is measured rather
  than asserted — and, as section 3 states, it has not been measured yet.
- **Single-tenant demo, no authentication.** One brand, one SQLite file, no user accounts,
  no tenancy boundary, and the deployment is plain HTTP with no domain or TLS. Anyone who
  can reach the IP can read the dashboard and press "Run now".
- **Not everything in `BUILD_PLAN.md` is built.** The worker loop and the
  Slack/Notion/Linear integrations are now in the repo; the dashboard pages and the API
  route that pushes a suggestion to Linear are not (see section 1). This brief describes
  what the code does, not what the plan intends.
- **No Notion page has been published yet.** `publishWeeklyReport()` is implemented and
  its blocks have been validated offline, but it has never been sent to the Notion API,
  because there is no collected history to report on. The first real publish should be
  watched: if `pages.create` rejects the inline `table` children, the fix is to create the
  page and append the table with `blocks.children.append`.
- **Prompts are unsteered.** The customer question is sent as-is with no system prompt, so
  what is measured is what the model says unprompted — but it also means we do not control
  answer format, and format variation is part of the extraction difficulty.

---

## 5. Known limitations and what we would do next

- **Gemini's free tier could not sustain the load.** `gemini-3.1-pro-preview` is published
  only as a preview id and has no free-tier quota, and `gemini-2.5-pro`/`2.5-flash` appear
  in `ListModels` but 404 on `generateContent` for this key. The mitigation shipped in the
  code is the cross-tier 429 fallback to `gemini-3.5-flash` described above; billing was
  subsequently enabled. The cost of the mitigation is that some Gemini answers come from a
  cheaper model than Claude's and GPT's, which is a real confound for cross-provider
  comparison. Next: pin one tier per provider and record tier explicitly as a dimension on
  the chart.
- **API collection is not what a logged-out user sees.** We call the Messages/Responses/
  generateContent APIs with a search tool. A real person in claude.ai, ChatGPT or the
  Gemini app hits a different stack: different system prompts, different search backends,
  personalization, memory and A/B-tested surfaces. Our numbers are a consistent,
  reproducible *proxy* for AI visibility, not a measurement of the consumer product.
  Next: sample the consumer surfaces periodically and publish the gap rather than assuming
  it is zero.
- **No correlation to actual traffic.** We measure mentions, not outcomes. Nothing in the
  system yet ties a visibility change to referral sessions, signups or revenue, so we
  cannot say what a 5-point visibility gain is worth. Next: join to GA4/Plausible referral
  data by day and report the correlation honestly, including if it turns out to be weak.
- **One run per day is a small sample.** 45 prompts × 3 providers = 135 answers per day,
  and model answers vary run to run. A day's visibility number has sampling noise we have
  not quantified. Next: repeat a subset of prompts within a day to estimate within-day
  variance, and put a confidence band on the trend line instead of a bare point.
- **The eval set is small and unlabelled.** Twenty answers is a smoke-level eval even once
  labelled, and a single labeller has no inter-rater agreement to check the sentiment
  rubric against. Next: label the set, then double-label a subset to measure how fuzzy the
  0-vs-+1 boundary really is before trusting the sentiment number.
- **Single box, single file, no backups.** Both processes, the database and the web server
  live on one VPS; `data/geo.db` is gitignored and never copied off. Next: a nightly
  `VACUUM INTO` snapshot off-box, which is a few lines and the highest-value reliability
  fix remaining.
