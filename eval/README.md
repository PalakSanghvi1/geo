# Extraction eval harness

Every number this product shows — visibility, position, sentiment — is produced by one
Haiku call in `src/pipeline/extract.ts` that turns an answer's prose into structured
brand mentions. If that call is wrong, the dashboard is confidently wrong. This harness
puts a number on how wrong it is, measured against **human** labels (not LLM labels).

Two scripts:

| Command | What it does |
|---|---|
| `npm run export-evalset` | Samples real answers out of the database into `evalset.json` for a human to label. |
| `npm run eval` | Re-runs the extractor on the labelled answers and prints precision / recall / F1, position accuracy and sentiment agreement, plus a per-answer mismatch breakdown. Writes `results.json`. |

Both scripts always exit 0. A bad score is information, not a crash.

---

## 1. Sample some answers

```bash
npm run export-evalset            # up to 20 answers
npm run export-evalset -- --n 30  # up to 30
```

This writes `eval/evalset.json`: an array of entries shaped

```json
{
  "answer_id": 142,
  "provider": "anthropic",
  "query_text": "What are the best production monitoring tools for AI agents?",
  "answer_text": "For production monitoring of AI agents, LangSmith is …",
  "expected": null
}
```

Sampling properties worth knowing:

- **Stratified across providers.** Entries are dealt round-robin across `anthropic`,
  `openai` and `gemini`, and spread evenly across each provider's answer history, so the
  set is not dominated by one model or one backfill day.
- **Re-running never destroys labelling work.** Every entry with a non-null `expected` is
  preserved verbatim; existing unlabelled entries are kept; only the remaining slots up to
  `N` are filled with answers not already in the file. The console output says exactly how
  many were preserved versus added.
- If the database has no `ok` answers yet, the script says so and exits 0 — run the
  pipeline first.

## 2. Label them by hand

Open `eval/evalset.json` and replace each `"expected": null` with the label below. Read
`answer_text` and record every **tracked** brand it actually mentions.

```json
"expected": {
  "mentions": [
    { "brand": "LangSmith", "sentiment": 1 },
    { "brand": "Langfuse",  "sentiment": 0 },
    { "brand": "Lemma",     "sentiment": 1 },
    { "brand": "Datadog",   "sentiment": -1 }
  ],
  "other_brands": ["PromptLayer", "Phoenix"]
}
```

Rules — these are exactly what the scorer assumes:

- **Order is the score.** `mentions` must be in order of **first appearance** in
  `answer_text`. Index 0 is position 1, index 1 is position 2, and so on. You never write
  a position number; the array order *is* the position.
- **Only tracked brands** go in `mentions`, spelled exactly as in the `brands` table
  (`Lemma`, `Raindrop`, `LangSmith`, `Langfuse`, `Braintrust`, `Arize`, `Helicone`,
  `Weights & Biases Weave`, `Galileo`, `Datadog`). An alias in the answer ("W&B",
  "wandb") is labelled under its canonical name. `npm run eval` warns loudly about any
  labelled name that is not in the roster, because such a label can never be matched.
- **Omit brands that are absent.** No entry means "not mentioned".
- **One entry per brand**, even if the answer names it five times.
- **`sentiment`** is what *this answer* says about *that brand*, not your own view:
  `1` recommended / praised / presented as a best choice, `0` listed or described
  factually, `-1` criticised, warned about, or framed as the worse option.
- **`other_brands`** is optional: same-category products or vendors that appear but are
  not tracked. It is reported for information but **not scored** — it feeds the
  "new competitor spotted" alert, not the precision number.
- An answer that mentions no tracked brand is a perfectly good label:
  `"expected": { "mentions": [] }`. Those answers test precision (the extractor should
  hallucinate nothing), so do not skip them.

Label independently of what the tool produced — do not open `results.json` first.

## 3. Score it

```bash
npm run eval
npm run eval -- --file eval/evalset.json --target 0.9   # optional flags
```

Entries still carrying `"expected": null` are ignored. If none are labelled, the script
prints these instructions and exits.

Extractions run with a concurrency of 3, so 20 answers take seconds rather than minutes.
A single extraction failure is recorded as a failed row and excluded from the metric
denominators (it is counted and printed separately) — one flaky API call does not abort
the run or silently depress the score.

---

## What the metrics mean

The unit is the **(answer, brand) pair**, micro-averaged over every labelled answer.

- **TP** — brand both predicted and labelled for that answer.
- **FP** — predicted but not labelled: a *hallucinated* mention.
- **FN** — labelled but not predicted: a *missed* mention.

| Metric | Definition |
|---|---|
| Mention precision | `TP / (TP + FP)` — of the mentions we report, how many are real. |
| Mention recall | `TP / (TP + FN)` — of the mentions that exist, how many we find. |
| Mention F1 | `2PR / (P + R)` — harmonic mean of the two. |
| Position accuracy | of the TP brands, the fraction whose predicted rank equals the labelled rank. |
| Sentiment agreement | of the TP brands, the fraction whose predicted sentiment equals the labelled sentiment. |

Position and sentiment are conditioned on TP on purpose: a brand that was never detected
has no rank or sentiment to be right or wrong about, and folding that in would count the
same detection failure twice.

**Target: precision ≥ 0.90 and recall ≥ 0.90** (BUILD_PLAN §6, Phase A3). The final line
prints `PASS` or `FAIL` against it. The exit code is 0 either way.

## Reading the output

```
=== Extraction eval ===

metric               value  target  status
-------------------  -----  ------  ------
Mention precision    0.958  0.90    PASS
Mention recall       0.885  0.90    FAIL
Mention F1           0.920  —
Position accuracy    0.864  —
Sentiment agreement  0.909  —

=== Per-answer breakdown (only rows with something to explain) ===

answer #142 [anthropic] What are the best production monitoring tools for AI agents?
  MISSED        Helicone
  POSITION      Lemma: expected #3, got #2
```

The breakdown is the actionable half. Typical readings:

- **MISSED (low recall)** — the answer names a brand in a form the prompt does not cover
  (an unlisted alias, a URL, a possessive). Fix: add the alias to the brand row, or
  tighten the matching rules in the `SYSTEM` prompt of `src/pipeline/extract.ts`.
- **HALLUCINATED (low precision)** — a brand was reported that the answer never
  discusses, often a near-miss on an ordinary English word. Fix: sharpen the "a word that
  merely resembles a brand name does not count" rule.
- **POSITION** — ranks disagree. Positions are recomputed in `extract.ts` from the
  model's `first_char_index`, so a mismatch usually means the model reported the offset
  of a *later* occurrence. Check whether the label counted a passing early mention that a
  human reader would skip.
- **SENTIMENT** — usually a `0` versus `1` disagreement on "listed in a roundup". Judge
  the label first; the boundary is genuinely fuzzy, and the score is only as sharp as the
  rubric above.

If precision or recall misses the target, edit the extraction prompt and re-run `npm run
eval` on the **same** labelled set. That iteration loop — and what changed between passes
— is written up in `docs/reliability-brief.md`.

## Files

| File | Committed? | Notes |
|---|---|---|
| `eval/evalset.json` | yes | Demo data, no secrets. The labels are the asset — never hand-edit them away. |
| `eval/results.json` | yes | Last scoring run: aggregate metrics plus per-answer detail (expected vs predicted brands, positions, sentiments, errors). |
