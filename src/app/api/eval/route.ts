/**
 * GET /api/eval  ->  the extractor's scored accuracy, or null
 *
 * Every number in this product is downstream of one extraction call, so the
 * extractor's own accuracy is the figure the rest depend on. It was measured
 * and committed to eval/results.json by `npm run eval`, and then never shown
 * anywhere — the claim lived in a terminal and a markdown file while the UI
 * asserted nothing. This route is what lets a page show it.
 *
 * Reads the committed file rather than scoring on request: scoring costs real
 * model calls, and a page load must never trigger them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, ok } from '../_lib/http';
import type { EvalSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Aggregate {
  answers_labelled?: number;
  answers_scored?: number;
  extraction_failures?: number;
  mention_precision?: number;
  mention_recall?: number;
  mention_f1?: number;
  position_accuracy?: number;
  sentiment_agreement?: number;
  passed?: boolean;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function GET() {
  try {
    const file = path.join(process.cwd(), 'eval', 'results.json');
    if (!fs.existsSync(file)) return ok<EvalSummary | null>(null);

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      generated_at?: string;
      extraction_model?: string;
      target?: number;
      aggregate?: Aggregate;
    };
    const a = parsed.aggregate ?? {};

    // An unscored harness must report nothing rather than a confident zero.
    const scored = num(a.answers_scored) ?? 0;
    if (scored <= 0) return ok<EvalSummary | null>(null);

    return ok<EvalSummary>({
      generatedAt: parsed.generated_at ?? null,
      extractionModel: parsed.extraction_model ?? null,
      target: num(parsed.target),
      answersScored: scored,
      answersLabelled: num(a.answers_labelled) ?? scored,
      extractionFailures: num(a.extraction_failures) ?? 0,
      precision: num(a.mention_precision),
      recall: num(a.mention_recall),
      f1: num(a.mention_f1),
      positionAccuracy: num(a.position_accuracy),
      sentimentAgreement: num(a.sentiment_agreement),
      passed: a.passed === true,
    });
  } catch (err) {
    return fail(err);
  }
}
