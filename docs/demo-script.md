# Two-minute demo script

Spoken lines are written to be **said, not read**. Short sentences, contractions, one
idea at a time. Anything in _italics_ is a stage direction, not narration.

**Target: 115 seconds.** URL: http://5.78.222.163/geo

> **Re-check these numbers before recording** (`npm run status` on the VPS). If they have
> moved, change the words — never the data.

---

## The dataset you are actually showing

| | |
|---|---|
| Days plotted | 90 |
| Actually collected | **2** (Claude and GPT) |
| Illustrative placeholder | **88**, tagged `synthetic`, stated in the chart caption |
| Gemini | wired up, but it collected nothing real |
| Real answers | 180, with genuine citations |
| Sources page | 184 domains, **all real** — synthetic answers carry no citations |
| Eval | precision 0.95, recall 0.91 over 20 hand-labelled real answers |

---

## Never say

- **"Three months of history."** Say "three months plotted, two days collected."
- **"We track Claude, GPT and Gemini."** Gemini has no real data. Say "Claude and GPT, with Gemini wired up."
- **"Partial coverage" / "degraded"** — unless you have restored a failing run (see the note at 1:00).
- Any eval number you have not re-run that morning.

---

## 0:00 — Overview

> "People don't start at Google any more. They ask an AI what to buy — and nobody can see
> what it says about them. That's what this is.
>
> We're tracking Lemma, an AI-agent observability startup, against nine competitors.
> Visibility is just: out of all the answers we collected, how many mentioned you. Lemma's
> at [number], which puts it [rank] out of ten."

_Scroll the scoreboard slowly. Let the competitor names land._

## 0:20 — The chart, and say what it is

_Point at the caption under the title._

> "Quick honesty note, because the caption says it too — most of this line is placeholder
> history so you can see the shape. Two days are really collected. Everything else I show
> you is real."

_Ten seconds. Do not linger._

This is the most valuable sentence in the demo. You are pre-empting the one thing that,
if a judge found it on their own, would make them discount everything else. Say it
plainly, don't apologise, move on.

## 0:35 — A real answer

_Click through to an answer from a **real** day — 2026-09-06 or 2026-09-10. Have it open
in a second tab; don't hunt for it on camera._

> "Every day we put real buyer questions to Claude and GPT, with live web search on.
> This is an actual answer. We pull out every brand it named, in the order it named them,
> with sentiment and the quote it came from.
>
> And these are the sources the model actually cited. We flag the ones a competitor owns —
> so `docs.smith.langchain.com` still counts as LangSmith, even though the name isn't in
> the domain."

## 1:00 — Runs

> "This is every prompt against every model, with retries and per-provider health. These
> numbers are read, not estimated — we had it guessing a per-provider split at one point
> and took that out, because this is the one page whose whole job is saying what actually
> happened."

**If you restored a failing provider first** (see below), add — and this becomes the
strongest fifteen seconds in the recording:

> "Gemini's out of quota right now. The run still completed — partial, not failed. That's
> deliberate: a provider dying shrinks the day's coverage, it doesn't throw the day away.
> The metrics use what landed."

> **As the data stands, there is no failing run to point at.** Every run is `complete`
> with zero failures, and Gemini's card reads "no data". To get this beat back honestly,
> break one provider on purpose and let it fail for real:
> ```bash
> ssh root@5.78.222.163
> cd /var/www/html/geo && cp .env .env.bak
> sed -i 's/^GEMINI_API_KEY=.*/GEMINI_API_KEY=invalid/' .env
> npm run run-once -- --trigger manual      # ~4 min, real cost
> cp .env.bak .env && pm2 restart geo-worker
> ```
> That is a genuine failure genuinely handled — which is what BUILD_PLAN §6 A3 asked for
> in the first place. It also creates the first real live run, which lights up the
> backfilled/live marker on the chart.

## 1:20 — Slack

_`/geo run` in `#geo`._

> "News breaks and you don't want to wait for tomorrow — trigger a run from Slack. The
> digest comes back with the same numbers that are on the dashboard, because they read the
> same metrics module. They can't drift apart."

_Flash the Notion page **only** if it's been regenerated since the wording changed. The
published page keeps whatever it was written with._

## 1:40 — Suggestions → Linear

> "And here's the part nobody else does. GEO reads our Linear roadmap and works out what
> we should be tracking next. We're shipping voice-agent tracing this cycle — so it says
> track 'best voice agent monitoring tools'. One click and it's a Linear issue."

_Click through. Issues `GEO-5` and `GEO-6` already exist from real pushes, so this works._

## 1:55 — Close

> "Roadmap in, visibility out, alerts where you already work. That's GEO."

---

## Pre-flight

1. `ssh root@5.78.222.163 "cd /var/www/html/geo && npm run status"` — numbers match the table above.
2. Open the dashboard; confirm the caption renders and the chart draws.
3. `pm2 list` — `geo-web` and `geo-worker` online.
4. **Only one worker anywhere.** Slack sends each slash command to a single Socket Mode
   connection; a worker running on a laptop makes `/geo run` answer intermittently. Kill it.
5. Rehearse `/geo run` once — it posts to the channel, so do it before you're recording.
6. Real-day answer open in a second tab.

## If it breaks mid-take

- **Slack silent** → use the dashboard's "Run now". Same queue, same code path. Say so — that's a design point, not a save.
- **A page errors** → go to Runs. Most robust screen, and it carries the reliability story.
- **A number looks wrong** → say what you see and move on. Never debug on camera.
