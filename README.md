# GEO — AI visibility tracker

## Overview

People increasingly ask an AI assistant what to buy and who to trust, including
which vendors to hire. GEO measures how those assistants answer.

It runs a fixed set of natural-language customer questions against Claude, GPT and
Gemini every day **with web search on**, then reads each answer and records:

- **Visibility** — the share of answers that mention the brand
- **Position** — where the brand appears relative to competitors
- **Sentiment** — how the brand is described, −100…+100
- **Sources** — the domains and URLs the models cited

The demo subject is **Lemma** (uselemma.ai), tracked against nine competitors in the
AI-agent observability category.

Around the dashboard: a daily Slack digest and an on-demand `/geo run` command, a
weekly report published to Notion, and a scan that reads the team's Linear roadmap to
suggest what to track next — and files accepted suggestions back into Linear as issues.

## External apps used

| Service | What it does here |
|---|---|
| **Anthropic** | Claude Sonnet answers the tracked questions with web search; Haiku extracts brand mentions from every answer; Sonnet writes the Notion takeaways and the Linear suggestions |
| **OpenAI** | GPT answers the same questions through the Responses API with `web_search` |
| **Google Gemini** | Gemini answers the same questions with Google Search grounding |
| **Slack** | Socket Mode bot: daily digest, `/geo run`, `/geo status`. No public URL required |
| **Notion** | Weekly report published as a page under a parent page |
| **Linear** | Roadmap scan reads projects and suggests queries and competitors; accepted suggestions are filed back as issues |
| **QuickChart** | Renders the trend chart as an image URL for the Notion report, so no image hosting is needed |

Runtime: Next.js on an Ubuntu VPS behind nginx, two pm2 processes (web and worker),
SQLite in WAL mode.

## Setup

```bash
npm install
cp .env.example .env      # fill in the keys listed in that file
npm run migrate           # create the SQLite schema
npm run seed              # brands, 15 base questions, generated variations
npm run run-once          # one live run (add --limit 3 while testing)
npm run dev               # dashboard at http://localhost:3100/geo
npm run worker            # cron, Slack bot, and the run_requests poller
```

The worker is the only process that executes a run. The dashboard button, the daily
schedule and `/geo run` all insert a row into `run_requests`, which the worker polls —
so scheduled, manual and Slack-triggered runs share one code path.

Useful afterwards: `npm run seed-linear` creates the demo roadmap projects,
`npm run eval` scores the extractor, `npm run status` prints run health over SSH.

## How we tested reliability

**The extractor is measured, not assumed.** Every number the product reports comes out
of one extraction call per answer, so that call is scored against 20 labelled
answers (`npm run eval`). Current results, shown on the Runs page in the app:

| | |
|---|---|
| Mention precision | **95.2%** |
| Mention recall | **90.8%** |
| F1 | 92.9% |
| Position accuracy | 78.0% |
| Sentiment agreement | 71.2% |
| Extraction failures | 0 of 20 |

The eval caught a real defect: the extractor was returning a brand that did not appear
in the answer.

**A run never throws.** Every failure becomes a row rather than an exception — an
`answers` row with `status='error'` and a run finalised `partial`. A crash mid-run would
leave a day whose denominator silently shrank, which corrupts a percentage rather than
merely losing data.

**Retries live in one place.** 90-second per-call timeout, two retries at 2s and 8s on
429, 5xx and network errors, with the vendor SDKs' own retries disabled so one policy
applies. A rejected model id or a quota error switches to the fallback model immediately
rather than sleeping, because quota is per model tier.

**Providers fail independently.** Each has its own concurrency pool, so one throttled
provider slows only itself. Partial runs are first-class: metrics are computed over `ok`
answers only, and coverage is reported alongside as its own series. The Runs page shows
per-provider health, and a degraded provider says so rather than being averaged away.

**Extraction is a separate failure domain from collection.** A failed extraction keeps
the answer text and records the failure; it never discards a collected answer.

**What is real and what is not.** The answers are real model responses collected with
live web search. Most of the historical dates are **illustrative placeholder data**, and
the dashboard says so on the chart itself rather than in a footnote. Days that were
genuinely collected are labelled as such, and a day that collected nothing under a given
filter reports a gap rather than a zero.

## Demo

Two-minute walkthrough: **[link to be added]**
