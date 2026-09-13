# Two-minute demo script

Supersedes the script in `BUILD_PLAN.md` §10, which was written against the
planned dataset (8 run days, three providers). Record from this one.

**Record against** `http://5.78.222.163/geo`, 1440×900 or larger, one take.

## What is actually on the VPS

| | Planned | Actual |
|---|---|---|
| Run days | 8 (7 backfill + today) | **2** — API credits ran out mid-backfill |
| Providers with answers | Claude, GPT, Gemini | **Claude and GPT.** Gemini is out of quota and collected nothing |
| Prompts | 45 | read the Prompts page header on the day; don't quote from memory |

Everything below is written so that none of it becomes false if those numbers
move. Read live numbers off the screen as you narrate rather than reciting
them — the run cadence changes them under you.

### Never say

- "eight days of history", "a week of trend data", or anything implying a
  longer window than the chart's own caption states
- "Claude, GPT and Gemini" — two models answered
- "daily tracking, running every day since…" — the dates are simulated
- a precision/recall figure unless `npm run eval` has been run against real
  labels and you are reading its output

### Say instead

- "two days collected so far, and the dates on the backfilled day are
  simulated — same-day real runs replayed onto past dates. The answers are
  real; the calendar isn't."

## Beats (target 115s)

**0:00 — Overview, stat cards and scoreboard.** Open on the page as it loads.

> "AI answers are the new search results, and nobody can see how they talk
> about them. This is GEO. We're tracking Lemma, an AI-agent-observability
> startup, against nine competitors — visibility is the share of answers that
> mention each brand, and Lemma is at [read the number], rank [read it] of ten."

Scroll the scoreboard. Don't touch the date-range dropdown: it offers 14 days
and only two exist.

**0:20 — the chart, briefly.** Point at the caption under the title.

> "Two run days so far — the caption says so, and the dashed line is where
> backfilled history ends and live collection begins. We ran out of API
> credits before the full backfill, so this is a short window of real answers
> rather than a long window of invented ones."

Then move on. The chart is the weakest shot in the demo right now; give it ten
seconds, not thirty. If the shape is flat, say so and move — a line that
doesn't move is an honest line.

**0:35 — Answer detail, then Sources.** Click a prompt through to an answer.

> "Every day we put real buyer questions to Claude and GPT with live web
> search. Here's an actual answer, and every brand mention pulled out of it —
> positioned, sentiment-scored, quoted. And these are the sources the model
> cited: we flag the ones a competitor owns, by domain, so a subdomain like
> docs.smith.langchain.com still counts as LangSmith's."

(The domain matching is PR #6. If that isn't deployed yet, cut the last clause.)

**1:00 — Runs. This is the reliability beat, and today it is unusually good.**

> "Every prompt × model call, with retries and per-provider health. Gemini is
> out of quota, so it collected nothing — and the run is still marked complete
> with partial coverage. That's deliberate: a provider dying degrades the day's
> denominator, it doesn't fail the day. The metrics use what landed."

The degraded Gemini card is a live failure being handled correctly on camera.
Don't apologise for it; it is the strongest 15 seconds in the recording.

**1:20 — Slack, then Notion.** `/geo run` in `#geo`; digest posts back.

> "News drops? Trigger a run from Slack, and the digest posts back with the
> same numbers the dashboard shows — one metrics module, so they can't drift.
> Weekly reports publish to Notion."

Flash the Notion page only if it has been regenerated since this change; the
published page carries whatever wording it was written with.

**1:40 — Suggestions → Linear.**

> "And the part nobody else does: GEO reads our Linear roadmap and proposes
> what to track next. We're shipping voice-agent tracing, so it suggests
> tracking 'best voice agent monitoring tools' — and files it back into Linear."

**1:55 — Close.**

> "Roadmap in, visibility out, alerts where you work. That's GEO."

## Pre-flight, ~10 minutes before recording

1. `http://5.78.222.163/geo` loads; stat cards populated, no error banner.
2. Model tabs read **All models · Claude · GPT**. A Gemini tab means the
   deployed build predates this change — redeploy before recording.
3. The chart caption states the run-day count. If it says a number you don't
   expect, the narration above still holds; the caption is the source of truth.
4. Runs page: Gemini card reads `0/N · N failed · degraded`.
5. `/geo status` answers in Slack (one worker only — a second `npm run worker`
   on a laptop steals the Socket Mode connection).
6. Suggestions page has at least one pending row with a Linear rationale.

Record at the start of your window, not the end.
