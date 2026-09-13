# Two-minute demo script

Written against the dataset that is actually deployed, not the one `BUILD_PLAN.md` §10
assumed. Re-check the numbers with `npm run status` on the VPS before recording — if they
have moved, change the words, not the data.

**Target: 115 seconds.** URL: http://5.78.222.163/geo

---

## What is actually on the box right now

| | |
|---|---|
| Run days plotted | 90 |
| Collected from real providers | **2** (Claude and GPT) |
| Fabricated ("illustrative") | **88**, tagged `trigger='synthetic'` |
| Gemini | present in the data, but **every Gemini row is synthetic** — it collected nothing real |
| Real answers | 180, with genuine citations |
| Sources page | 184 domains, **100% real** (synthetic answers carry no citations) |
| Eval | precision 0.95, recall 0.91, F1 0.93 over 20 hand-labelled real answers |

---

## Never say these

- **"Three months of history."** Say "three months plotted, two days collected."
- **"We track Claude, GPT and Gemini."** Gemini has no real data. Say "Claude and GPT, with Gemini wired up."
- **Any eval number you have not re-run.** The extractor is non-deterministic; quoting a
  stale decimal that the live run contradicts is worse than quoting none.
- **"Real-time" / "live data"** about the trend line. The trend is illustrative.

The chart caption says this on screen already. Let it do the work — agreeing with your own
UI costs three seconds and buys every other claim credibility.

---

## Beats

**0:00–0:20 — The problem and the screen.**
> "Your customers ask AI which tool to buy. Nobody can see those answers. GEO runs 45 real
> customer questions against Claude and GPT every day with live web search, and measures
> how often each brand gets named, where it ranks, and how it's described."

Overview page. Point at Lemma versus nine competitors.

**0:20–0:35 — Say what the data is, once, plainly.**
> "The history here is illustrative so the trends are visible — the caption says so. Two
> days are really collected. Everything I show you from here is real."

Point at the caption under the chart. This is the most valuable fifteen seconds in the
demo: you are pre-empting the one discovery that would make a judge distrust the rest.

**0:35–1:00 — A real answer.**
Click a **real** day (2026-09-06 or 2026-09-10 — the Runs page shows `trigger`), then into
an answer.
> "This is an actual GPT response with web search on. Every brand extracted, in the order
> it was named, with sentiment and the sources the model cited. Those citations are real —
> the Sources page is built only from retrieved results, never from placeholder history."

**1:00–1:20 — Reliability, shown not claimed.**
Runs page.
> "Providers fail. Gemini ran out of quota mid-build, so that run completed *partial* and
> the metrics used what landed instead of failing the day. And we measure our own
> extractor: 95% precision against hand-labelled answers — it's the instrument every
> number here depends on, so we grade it."

**1:20–1:45 — Slack, and the thing nobody else does.**
> "News breaks? Trigger a run from Slack." — `/geo run`, digest returns.
> "And GEO reads our Linear roadmap to suggest what to track next. We're shipping voice
> agent tracing, so it proposes tracking 'best voice agent monitoring tools' — and files it
> back into Linear as an issue."

Suggestions page → push to Linear.

**1:45–1:55 — Close.**
> "Roadmap in, visibility out, alerts where you already work."

---

## Pre-flight, in order

1. `ssh root@5.78.222.163 "cd /var/www/html/geo && npm run status"` — confirm counts match the table above.
2. Open http://5.78.222.163/geo — confirm the caption renders and the chart draws.
3. Confirm `pm2 list` shows `geo-web` and `geo-worker` online.
4. **Only one worker may run anywhere.** Slack delivers a slash command to a single Socket
   Mode connection — a laptop worker makes `/geo run` answer intermittently. Kill any local one.
5. Rehearse `/geo run` once. It posts to the channel, so do it before you are recording.
6. Have a real-day answer open in a second tab; do not hunt for one on camera.

## If something breaks mid-demo

- **Slack silent** → the dashboard "Run now" button does the same thing through the same
  queue. Use it and say so; that shared code path is a design point, not a save.
- **A page errors** → go to Runs. It is the most robust screen and carries the reliability story.
- **Numbers look wrong** → say what you see and move on. Do not debug on camera.
