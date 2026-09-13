/**
 * Score the extractor against hand-labelled answers.
 *
 *   npm run eval
 *   npm run eval -- --file eval/evalset.json --target 0.9
 *
 * Extraction is the measurement instrument of the whole product: every visibility,
 * position and sentiment number on the dashboard is downstream of it. So it is held to
 * a number, not to inspection. This script re-runs `extractMentions()` over the labelled
 * answers in `eval/evalset.json` and reports:
 *
 *   Mention precision / recall / F1 — unit is the (answer, brand) pair, micro-averaged
 *     over all answers. TP = brand predicted and expected. FP = predicted, not expected
 *     (a hallucinated mention). FN = expected, not predicted (a missed mention).
 *   Position accuracy — of the TP brands, the fraction whose predicted rank (order of
 *     first appearance) equals the labelled rank.
 *   Sentiment agreement — of the TP brands, the fraction whose predicted sentiment
 *     (-1/0/+1) equals the labelled sentiment.
 *
 * Position and sentiment are conditioned on TP deliberately: a brand that was never
 * detected has no rank or sentiment to be right or wrong about, and mixing that into the
 * same number would double-count the detection failure.
 *
 * Exits 0 whatever the score — a low number is information, not a crash — but prints an
 * explicit PASS/FAIL against the 0.90 precision/recall target from BUILD_PLAN §6 A3.
 */
import '../src/lib/env';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, parseJson } from '../src/lib/db';
import { EXTRACTION_MODEL } from '../src/lib/config';
import { extractMentions } from '../src/pipeline/extract';
import type { Brand, ExtractionResult, Sentiment } from '../src/lib/types';

/* ---------------------------------------------------------------- */
/* Eval set shapes (mirrors scripts/export-evalset.ts)               */
/* ---------------------------------------------------------------- */

interface ExpectedLabel {
  /** Brands in order of FIRST APPEARANCE in the answer. Index 0 = position 1. */
  mentions: Array<{ brand: string; sentiment: Sentiment }>;
  /** Optional: same-category names present but not tracked. Reported, not scored. */
  other_brands?: string[];
}

interface EvalEntry {
  answer_id: number;
  provider: string;
  query_text: string;
  answer_text: string;
  expected: ExpectedLabel | null;
}

/* ---------------------------------------------------------------- */
/* Per-answer result                                                 */
/* ---------------------------------------------------------------- */

interface BrandDiff {
  brand: string;
  expected_position?: number;
  predicted_position?: number;
  expected_sentiment?: Sentiment;
  predicted_sentiment?: Sentiment;
}

interface AnswerResult {
  answer_id: number;
  provider: string;
  query_text: string;
  status: 'scored' | 'extraction_failed' | 'invalid_label';
  error?: string;
  expected_brands: string[];
  predicted_brands: string[];
  /** Correctly detected. */
  true_positives: BrandDiff[];
  /** Predicted but not labelled — hallucinated mentions. */
  false_positives: string[];
  /** Labelled but not predicted — missed mentions. */
  false_negatives: string[];
  position_mismatches: BrandDiff[];
  sentiment_mismatches: BrandDiff[];
  /** Informational only — never scored. */
  other_brands_expected?: string[];
  other_brands_predicted?: string[];
}

const DEFAULT_TARGET = 0.9;
const CONCURRENCY = 3;
const EVAL_DIR = path.join(process.cwd(), 'eval');
const DEFAULT_EVALSET = path.join(EVAL_DIR, 'evalset.json');
const RESULTS_PATH = path.join(EVAL_DIR, 'results.json');

/* ---------------------------------------------------------------- */
/* Small helpers                                                     */
/* ---------------------------------------------------------------- */

function flagValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1];
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return undefined;
}

const key = (brand: string) => brand.trim().toLowerCase();

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function fmt(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

/** Minimal fixed-width table so the output reads cleanly in a terminal and in a PR. */
function printTable(header: string[], rows: string[][]) {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

/** Run `fn` over items with at most `limit` in flight. Order of results is preserved. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function howToLabel(file: string) {
  console.log('eval: nothing to score yet — no entry in the eval set has a non-null "expected".');
  console.log('');
  console.log('To produce a score:');
  console.log('  1. npm run export-evalset        # samples ok answers into eval/evalset.json');
  console.log(`  2. open ${file} and fill in each "expected", e.g.`);
  console.log('');
  console.log('     "expected": {');
  console.log('       "mentions": [');
  console.log('         { "brand": "LangSmith", "sentiment": 1 },');
  console.log('         { "brand": "Lemma",     "sentiment": 0 }');
  console.log('       ],');
  console.log('       "other_brands": ["PromptLayer"]');
  console.log('     }');
  console.log('');
  console.log('     mentions are in order of FIRST APPEARANCE in answer_text;');
  console.log('     sentiment is -1 negative / 0 neutral / 1 positive;');
  console.log('     use the exact brand names from the `brands` table; omit absent brands.');
  console.log('  3. npm run eval');
  console.log('');
  console.log('Full instructions and a worked example: eval/README.md');
}

/* ---------------------------------------------------------------- */
/* Main                                                              */
/* ---------------------------------------------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  const file = path.resolve(process.cwd(), flagValue(argv, 'file') ?? DEFAULT_EVALSET);
  const targetRaw = Number.parseFloat(flagValue(argv, 'target') ?? '');
  const target = Number.isFinite(targetRaw) && targetRaw > 0 && targetRaw <= 1 ? targetRaw : DEFAULT_TARGET;

  if (!fs.existsSync(file)) {
    console.log(`eval: ${file} does not exist yet.`);
    console.log('');
    howToLabel(file);
    return;
  }

  let entries: EvalEntry[];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array of eval entries');
    entries = parsed as EvalEntry[];
  } catch (e) {
    console.log(`eval: could not read ${file} — ${String(e)}`);
    console.log('Fix the file (or delete it and re-run `npm run export-evalset`) and try again.');
    return;
  }

  const labelled = entries.filter((e) => e && e.expected != null);
  if (labelled.length === 0) {
    howToLabel(file);
    return;
  }

  // Brand roster — the extractor can only ever return brands that are on it.
  let brands: Brand[] = [];
  try {
    const rows = all<{ id: number; name: string; is_self: number; aliases: string }>(
      `SELECT id, name, is_self, aliases FROM brands ORDER BY id`
    );
    brands = rows.map((r) => ({
      id: r.id,
      name: r.name,
      is_self: (r.is_self ? 1 : 0) as 0 | 1,
      aliases: parseJson<string[]>(r.aliases, []),
    }));
  } catch {
    brands = [];
  }

  if (brands.length === 0) {
    console.log('eval: the `brands` table is empty, so the extractor has no roster to match against.');
    console.log('Run `npm run migrate` and `npm run seed` first, then re-run `npm run eval`.');
    return;
  }

  const roster = new Set(brands.map((b) => key(b.name)));
  const canonical = new Map(brands.map((b) => [key(b.name), b.name]));

  // A label naming a brand that is not on the roster can never be matched — that is a
  // labelling bug, not an extractor bug, so surface it separately rather than silently
  // tanking recall.
  const unknownLabelBrands = new Set<string>();
  for (const e of labelled) {
    for (const m of e.expected?.mentions ?? []) {
      if (m && typeof m.brand === 'string' && !roster.has(key(m.brand))) unknownLabelBrands.add(m.brand);
    }
  }

  console.log(
    `eval: scoring ${labelled.length} labelled answer(s) from ${file} with ${EXTRACTION_MODEL} (concurrency ${CONCURRENCY})…`
  );

  const results = await mapPool(labelled, CONCURRENCY, async (entry) => scoreOne(entry, brands, canonical));

  /* ---- aggregate ------------------------------------------------ */

  const scored = results.filter((r) => r.status === 'scored');
  const failed = results.filter((r) => r.status === 'extraction_failed');
  const invalid = results.filter((r) => r.status === 'invalid_label');

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let positionMatches = 0;
  let sentimentMatches = 0;
  for (const r of scored) {
    tp += r.true_positives.length;
    fp += r.false_positives.length;
    fn += r.false_negatives.length;
    positionMatches += r.true_positives.length - r.position_mismatches.length;
    sentimentMatches += r.true_positives.length - r.sentiment_mismatches.length;
  }

  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  const positionAccuracy = ratio(positionMatches, tp);
  const sentimentAgreement = ratio(sentimentMatches, tp);

  /* ---- print ---------------------------------------------------- */

  const status = (v: number | null) => (v === null ? '—' : v >= target ? 'PASS' : 'FAIL');

  console.log('');
  console.log('=== Extraction eval ===');
  console.log('');
  printTable(
    ['metric', 'value', 'target', 'status'],
    [
      ['Mention precision', fmt(precision), target.toFixed(2), status(precision)],
      ['Mention recall', fmt(recall), target.toFixed(2), status(recall)],
      ['Mention F1', fmt(f1), '—', ''],
      ['Position accuracy', fmt(positionAccuracy), '—', ''],
      ['Sentiment agreement', fmt(sentimentAgreement), '—', ''],
    ]
  );

  console.log('');
  printTable(
    ['counts', ''],
    [
      ['answers labelled', String(labelled.length)],
      ['answers scored', String(scored.length)],
      ['extraction failures', String(failed.length)],
      ['invalid labels', String(invalid.length)],
      ['true positives (brand correctly found)', String(tp)],
      ['false positives (hallucinated)', String(fp)],
      ['false negatives (missed)', String(fn)],
    ]
  );

  if (unknownLabelBrands.size > 0) {
    console.log('');
    console.log(
      `WARNING: ${unknownLabelBrands.size} labelled brand name(s) are not in the brands table and can never be matched:`
    );
    console.log(`  ${[...unknownLabelBrands].join(', ')}`);
    console.log('  Fix the spelling in the eval set, or add the brand with `npm run seed`.');
  }

  /* ---- per-answer breakdown ------------------------------------- */

  console.log('');
  console.log('=== Per-answer breakdown (only rows with something to explain) ===');
  let clean = 0;
  for (const r of results) {
    const problem =
      r.status !== 'scored' ||
      r.false_negatives.length > 0 ||
      r.false_positives.length > 0 ||
      r.position_mismatches.length > 0 ||
      r.sentiment_mismatches.length > 0;
    if (!problem) {
      clean++;
      continue;
    }
    console.log('');
    console.log(`answer #${r.answer_id} [${r.provider}] ${r.query_text.slice(0, 70)}`);
    if (r.status !== 'scored') {
      console.log(`  ${r.status.toUpperCase()}: ${r.error ?? 'unknown error'}`);
      continue;
    }
    if (r.false_negatives.length) console.log(`  MISSED        ${r.false_negatives.join(', ')}`);
    if (r.false_positives.length) console.log(`  HALLUCINATED  ${r.false_positives.join(', ')}`);
    for (const d of r.position_mismatches) {
      console.log(`  POSITION      ${d.brand}: expected #${d.expected_position}, got #${d.predicted_position}`);
    }
    for (const d of r.sentiment_mismatches) {
      console.log(
        `  SENTIMENT     ${d.brand}: expected ${d.expected_sentiment}, got ${d.predicted_sentiment}`
      );
    }
  }
  console.log('');
  console.log(`${clean} of ${results.length} answers matched their label exactly.`);

  /* ---- results.json --------------------------------------------- */

  const payload = {
    generated_at: new Date().toISOString(),
    evalset: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    extraction_model: EXTRACTION_MODEL,
    target,
    aggregate: {
      answers_labelled: labelled.length,
      answers_scored: scored.length,
      extraction_failures: failed.length,
      invalid_labels: invalid.length,
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      mention_precision: precision,
      mention_recall: recall,
      mention_f1: f1,
      position_accuracy: positionAccuracy,
      sentiment_agreement: sentimentAgreement,
      passed: precision !== null && recall !== null && precision >= target && recall >= target,
    },
    unknown_label_brands: [...unknownLabelBrands],
    per_answer: results,
  };

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Full detail written to ${RESULTS_PATH}`);

  console.log('');
  if (payload.aggregate.passed) {
    console.log(
      `PASS — precision ${fmt(precision)} and recall ${fmt(recall)} both meet the ${target.toFixed(2)} target.`
    );
  } else {
    console.log(
      `FAIL — precision ${fmt(precision)} / recall ${fmt(recall)} against a ${target.toFixed(2)} target. ` +
        'Read the breakdown above, adjust the extraction prompt in src/pipeline/extract.ts, and re-run.'
    );
  }
}

/* ---------------------------------------------------------------- */
/* Scoring one answer                                                */
/* ---------------------------------------------------------------- */

async function scoreOne(
  entry: EvalEntry,
  brands: Brand[],
  canonical: Map<string, string>
): Promise<AnswerResult> {
  const base: AnswerResult = {
    answer_id: entry.answer_id,
    provider: entry.provider ?? 'unknown',
    query_text: entry.query_text ?? '',
    status: 'scored',
    expected_brands: [],
    predicted_brands: [],
    true_positives: [],
    false_positives: [],
    false_negatives: [],
    position_mismatches: [],
    sentiment_mismatches: [],
  };

  // --- validate the label -----------------------------------------
  const expected = entry.expected;
  if (!expected || !Array.isArray(expected.mentions)) {
    return { ...base, status: 'invalid_label', error: '"expected.mentions" is missing or not an array' };
  }

  // Positions come from the array order (index 0 = position 1); duplicates keep the
  // first occurrence so a sloppy label cannot invent a second rank for one brand.
  const expectedByBrand = new Map<string, { brand: string; position: number; sentiment: Sentiment }>();
  for (const m of expected.mentions) {
    if (!m || typeof m.brand !== 'string' || !m.brand.trim()) {
      return { ...base, status: 'invalid_label', error: 'a mention entry has no "brand" string' };
    }
    const k = key(m.brand);
    if (expectedByBrand.has(k)) continue;
    const s: Sentiment = m.sentiment === 1 || m.sentiment === -1 ? m.sentiment : 0;
    expectedByBrand.set(k, {
      brand: canonical.get(k) ?? m.brand.trim(),
      position: expectedByBrand.size + 1,
      sentiment: s,
    });
  }
  base.expected_brands = [...expectedByBrand.values()].map((e) => e.brand);
  base.other_brands_expected = Array.isArray(expected.other_brands) ? expected.other_brands : [];

  // --- run the extractor ------------------------------------------
  // A single failure is a recorded row, never an aborted run: one flaky API call must
  // not cost the other 19 extractions.
  let extraction: ExtractionResult;
  try {
    const text = typeof entry.answer_text === 'string' ? entry.answer_text : await fetchAnswerText(entry.answer_id);
    if (!text) throw new Error('no answer_text in the eval set and none found in the database');
    extraction = await extractMentions(text, brands);
  } catch (e) {
    return {
      ...base,
      status: 'extraction_failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const predictedByBrand = new Map<string, { brand: string; position: number; sentiment: Sentiment }>();
  for (const m of extraction.mentions) {
    const k = key(m.brand);
    if (predictedByBrand.has(k)) continue;
    predictedByBrand.set(k, { brand: m.brand, position: m.order, sentiment: m.sentiment });
  }
  base.predicted_brands = [...predictedByBrand.values()].map((p) => p.brand);
  base.other_brands_predicted = extraction.other_brands;

  // --- compare -----------------------------------------------------
  for (const [k, exp] of expectedByBrand) {
    const pred = predictedByBrand.get(k);
    if (!pred) {
      base.false_negatives.push(exp.brand);
      continue;
    }
    const diff: BrandDiff = {
      brand: exp.brand,
      expected_position: exp.position,
      predicted_position: pred.position,
      expected_sentiment: exp.sentiment,
      predicted_sentiment: pred.sentiment,
    };
    base.true_positives.push(diff);
    if (exp.position !== pred.position) base.position_mismatches.push(diff);
    if (exp.sentiment !== pred.sentiment) base.sentiment_mismatches.push(diff);
  }
  for (const [k, pred] of predictedByBrand) {
    if (!expectedByBrand.has(k)) base.false_positives.push(pred.brand);
  }

  return base;
}

/** Fallback for eval sets that carry only answer_id (older hand-written files). */
async function fetchAnswerText(answerId: number): Promise<string | null> {
  try {
    const row = get<{ answer_text: string | null }>(`SELECT answer_text FROM answers WHERE id = ?`, [
      answerId,
    ]);
    return row?.answer_text ?? null;
  } catch {
    return null;
  }
}

main().catch((e) => {
  // Even an unexpected failure exits 0 with an explanation: this script is a
  // measurement, and a crash here must not fail a deploy or a CI step.
  console.error(`eval: unexpected failure — ${e instanceof Error ? e.stack : String(e)}`);
});
