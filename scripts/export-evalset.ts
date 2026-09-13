/**
 * Sample real answers out of the database into a file a human can hand-label.
 *
 *   npm run export-evalset            # up to 20 answers
 *   npm run export-evalset -- --n 30  # up to 30
 *
 * The output (`eval/evalset.json`) is the input to `npm run eval`, which scores the
 * Haiku extractor against these human labels. See eval/README.md for the label format.
 *
 * Two properties this script guarantees, because both cost real human time to get wrong:
 *
 *   1. **Stratified sampling.** Answers are drawn round-robin across providers and
 *      spread evenly across each provider's answer history (stride sampling, not the
 *      first N rows), so the eval set is not dominated by one model or one run date.
 *   2. **Never clobber labelling work.** Re-running is safe: every entry that already
 *      has a non-null `expected` is preserved verbatim, existing unlabelled entries are
 *      kept, and only the remaining slots up to N are filled with new answers.
 */
import '../src/lib/env';
import fs from 'node:fs';
import path from 'node:path';
import { all, get } from '../src/lib/db';
import type { ProviderId, Sentiment } from '../src/lib/types';

/** One row of the eval set. `expected` is null until a human fills it in. */
export interface EvalEntry {
  answer_id: number;
  provider: string;
  query_text: string;
  answer_text: string;
  expected: ExpectedLabel | null;
}

/** The human label: brands in order of first appearance, plus untracked brands seen. */
export interface ExpectedLabel {
  mentions: Array<{ brand: string; sentiment: Sentiment }>;
  other_brands?: string[];
}

const DEFAULT_N = 20;
const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini'];

const EVAL_DIR = path.join(process.cwd(), 'eval');
const EVALSET_PATH = path.join(EVAL_DIR, 'evalset.json');

interface CandidateRow {
  answer_id: number;
  provider: string;
  query_text: string;
  answer_text: string;
}

function parseN(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let raw: string | undefined;
    if (arg === '--n' || arg === '-n') raw = argv[i + 1];
    else if (arg.startsWith('--n=')) raw = arg.slice('--n='.length);
    if (raw === undefined) continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
    console.warn(`export-evalset: ignoring invalid --n "${raw}", using ${DEFAULT_N}`);
  }
  return DEFAULT_N;
}

/** The schema may not exist yet on a fresh clone — that is a message, not a stack trace. */
function tableExists(name: string): boolean {
  try {
    return !!get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [
      name,
    ]);
  } catch {
    return false;
  }
}

function loadExisting(): EvalEntry[] {
  if (!fs.existsSync(EVALSET_PATH)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(EVALSET_PATH, 'utf8'));
  } catch (e) {
    // Refuse to overwrite a file we cannot understand — it may contain hand labels.
    console.error(`export-evalset: ${EVALSET_PATH} exists but is not valid JSON (${String(e)}).`);
    console.error('Fix or move that file before re-running — it may contain labelling work.');
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`export-evalset: ${EVALSET_PATH} is not a JSON array. Refusing to overwrite it.`);
    process.exit(1);
  }
  return parsed as EvalEntry[];
}

/**
 * Pick `count` items spread evenly across the list rather than taking the head, so a
 * sample spans every run date in the table instead of clustering on the first run.
 */
function stride<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const step = items.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

function main() {
  const target = parseN(process.argv.slice(2));

  if (!tableExists('answers')) {
    console.log('export-evalset: no `answers` table yet.');
    console.log('Run `npm run migrate`, then `npm run seed`, then the pipeline (`npm run run-once`)');
    console.log('to collect some answers, then re-run `npm run export-evalset`.');
    return;
  }

  const candidates = all<CandidateRow>(
    `SELECT a.id AS answer_id,
            a.provider  AS provider,
            q.text      AS query_text,
            a.answer_text AS answer_text
       FROM answers a
       JOIN queries q ON q.id = a.query_id
       JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'ok'
        AND a.answer_text IS NOT NULL
        AND TRIM(a.answer_text) <> ''
        -- Synthetic answers are templated text listing their own brands, so scoring
        -- the extractor against them would measure nothing but string matching and
        -- report a flattering, meaningless number. Only real model output counts.
        AND r.trigger != 'synthetic'
      ORDER BY a.id`
  );

  const existing = loadExisting();
  const labelled = existing.filter((e) => e && e.expected != null);
  const unlabelled = existing.filter((e) => e && e.expected == null);

  if (candidates.length === 0) {
    console.log('export-evalset: the database has no successful answers yet.');
    console.log('Run the pipeline first (`npm run seed` then `npm run run-once`), then re-run this.');
    if (existing.length > 0) {
      console.log(
        `Left ${EVALSET_PATH} untouched (${labelled.length} labelled, ${unlabelled.length} unlabelled).`
      );
    }
    return;
  }

  // Slots left after preserving everything already in the file.
  const kept = [...labelled, ...unlabelled];
  const slots = Math.max(0, target - kept.length);
  const alreadyIn = new Set(kept.map((e) => e.answer_id));

  // Stratify: bucket by provider, stride-sample generously within each bucket, then
  // deal round-robin so no provider can dominate even if it has far more answers.
  const fresh = candidates.filter((c) => !alreadyIn.has(c.answer_id));
  const byProvider = new Map<string, CandidateRow[]>();
  for (const p of PROVIDERS) byProvider.set(p, []);
  for (const c of fresh) {
    if (!byProvider.has(c.provider)) byProvider.set(c.provider, []); // unknown provider: still sampled
    byProvider.get(c.provider)!.push(c);
  }

  const buckets = [...byProvider.entries()]
    .filter(([, rows]) => rows.length > 0)
    .map(([provider, rows]) => ({
      provider,
      // Over-sample per bucket so round-robin can still fill N if a provider runs dry.
      pool: stride(rows, Math.min(rows.length, Math.max(slots, 1))),
    }));

  const picked: CandidateRow[] = [];
  for (let i = 0; picked.length < slots && buckets.some((b) => i < b.pool.length); i++) {
    for (const b of buckets) {
      if (picked.length >= slots) break;
      if (i < b.pool.length) picked.push(b.pool[i]);
    }
  }

  const added: EvalEntry[] = picked.map((c) => ({
    answer_id: c.answer_id,
    provider: c.provider,
    query_text: c.query_text,
    answer_text: c.answer_text,
    expected: null,
  }));

  const out = [...kept, ...added];

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  fs.writeFileSync(EVALSET_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  const counts = new Map<string, number>();
  for (const e of out) counts.set(e.provider, (counts.get(e.provider) ?? 0) + 1);
  const split = [...counts.entries()].map(([p, n]) => `${p} ${n}`).join(' · ');

  console.log(`export-evalset: wrote ${EVALSET_PATH}`);
  console.log(`  target N           ${target}`);
  console.log(`  candidates in DB   ${candidates.length} ok answers`);
  console.log(`  preserved labelled ${labelled.length} (hand labels untouched)`);
  console.log(`  preserved blank    ${unlabelled.length} (already in the file, still unlabelled)`);
  console.log(`  added new          ${added.length}`);
  console.log(`  total entries      ${out.length}  [${split}]`);
  if (added.length < slots) {
    console.log(
      `  note: only ${added.length} new answers were available for ${slots} open slot(s) — run the pipeline again for more.`
    );
  }
  const stillBlank = out.filter((e) => e.expected == null).length;
  if (stillBlank > 0) {
    console.log(`\nNext: hand-label the ${stillBlank} entries with "expected": null — see eval/README.md.`);
    console.log('Then run `npm run eval`.');
  } else {
    console.log('\nEvery entry is labelled. Run `npm run eval`.');
  }
}

main();
