import { getDb, all, get, run as exec } from '../lib/db';
import { ANSWER_MODELS, RUNNER } from '../lib/config';
import { callProvider } from './providers';
import { extractMentions } from './extract';
import type { Brand, ProviderId, RunStatus, RunTrigger } from '../lib/types';

/**
 * Executes one run: every active prompt against every selected model.
 *
 * The contract that makes the rest of the system trustworthy: **a run never throws.**
 * Every failure becomes a row — an `answers` row with status 'error', or a run marked
 * 'partial'. A crashed run would leave the dashboard showing a day that silently has
 * fewer answers than it should, which corrupts visibility (a percentage over a
 * denominator that quietly shrank) rather than just losing data.
 *
 * Providers are pooled independently, so Gemini being rate-limited slows Gemini only —
 * Claude and GPT keep going and the day lands as 'partial' with honest coverage.
 */

export interface RunOptions {
  /** Sample only the first N prompts — used by smoke tests and `run-once --limit`. */
  limit?: number;
  providers?: ProviderId[];
  onProgress?: (done: number, total: number) => void;
}

export interface RunSummary {
  runId: number;
  status: RunStatus;
  total: number;
  ok: number;
  failed: number;
  byProvider: Record<string, { ok: number; failed: number }>;
  elapsedMs: number;
}

interface Job {
  queryId: number;
  text: string;
  provider: ProviderId;
}

export async function executeRun(
  runDate: string,
  trigger: RunTrigger,
  opts: RunOptions = {}
): Promise<RunSummary> {
  const started = Date.now();
  const providers = opts.providers ?? ANSWER_MODELS.map((m) => m.provider);

  const queries = all<{ id: number; text: string }>(
    `SELECT id, text FROM queries WHERE active = 1 ORDER BY id` +
      (opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '')
  );

  const brands: Brand[] = all<{ id: number; name: string; is_self: number; aliases: string }>(
    `SELECT id, name, is_self, aliases FROM brands ORDER BY id`
  ).map((b) => ({
    id: b.id,
    name: b.name,
    is_self: b.is_self === 1 ? 1 : 0,
    aliases: safeAliases(b.aliases),
  }));

  const brandIdByName = new Map(brands.map((b) => [b.name, b.id]));

  const jobs: Job[] = [];
  for (const q of queries) {
    for (const provider of providers) jobs.push({ queryId: q.id, text: q.text, provider });
  }

  const insertRun = getDb().prepare(
    `INSERT INTO runs (run_date, trigger, status, total_calls) VALUES (?, ?, 'running', ?)`
  );
  const runId = Number(insertRun.run(runDate, trigger, jobs.length).lastInsertRowid);

  if (jobs.length === 0) {
    finalize(runId, 'failed', 0, 0);
    return {
      runId,
      status: 'failed',
      total: 0,
      ok: 0,
      failed: 0,
      byProvider: {},
      elapsedMs: Date.now() - started,
    };
  }

  const byProvider: Record<string, { ok: number; failed: number }> = {};
  for (const p of providers) byProvider[p] = { ok: 0, failed: 0 };
  let done = 0;

  // One independent pool per provider so a slow or throttled provider cannot
  // starve the others.
  await Promise.all(
    providers.map((provider) =>
      pool(
        jobs.filter((j) => j.provider === provider),
        RUNNER.concurrencyPerProvider,
        async (job) => {
          const outcome = await runJob(runId, job, brands, brandIdByName);
          byProvider[provider][outcome ? 'ok' : 'failed']++;
          done++;
          bumpCounts(runId, byProvider);
          opts.onProgress?.(done, jobs.length);
        }
      )
    )
  );

  const ok = Object.values(byProvider).reduce((n, v) => n + v.ok, 0);
  const failed = Object.values(byProvider).reduce((n, v) => n + v.failed, 0);
  const status: RunStatus = failed === 0 ? 'complete' : ok === 0 ? 'failed' : 'partial';
  finalize(runId, status, ok, failed);

  return {
    runId,
    status,
    total: jobs.length,
    ok,
    failed,
    byProvider,
    elapsedMs: Date.now() - started,
  };
}

/** Collect one answer and extract from it. Returns true when the answer landed. */
async function runJob(
  runId: number,
  job: Job,
  brands: Brand[],
  brandIdByName: Map<string, number>
): Promise<boolean> {
  const choice = ANSWER_MODELS.find((m) => m.provider === job.provider)!;

  let answerId: number;
  let text: string;

  try {
    const { answer } = await callProvider(job.provider, job.text);
    answerId = Number(
      getDb()
        .prepare(
          `INSERT INTO answers (run_id, query_id, provider, model_id, status, answer_text, citations, latency_ms)
           VALUES (?, ?, ?, ?, 'ok', ?, ?, ?)`
        )
        .run(
          runId,
          job.queryId,
          job.provider,
          answer.modelId,
          answer.text,
          JSON.stringify(answer.citations),
          answer.latencyMs
        ).lastInsertRowid
    );
    text = answer.text;
  } catch (err) {
    exec(
      `INSERT INTO answers (run_id, query_id, provider, model_id, status, error)
       VALUES (?, ?, ?, ?, 'error', ?)`,
      [runId, job.queryId, job.provider, choice.primary, truncate(messageOf(err), 500)]
    );
    return false;
  }

  // Extraction is a separate failure domain: losing it must not lose the answer,
  // because the answer text is the expensive artefact and can be re-extracted later.
  try {
    const { mentions, other_brands } = await extractMentions(text, brands);
    const insertMention = getDb().prepare(
      `INSERT INTO mentions (answer_id, brand_id, position, sentiment, quote) VALUES (?, ?, ?, ?, ?)`
    );
    const tx = getDb().transaction(() => {
      for (const m of mentions) {
        const brandId = brandIdByName.get(m.brand);
        if (!brandId) continue;
        insertMention.run(answerId, brandId, m.order, m.sentiment, m.quote || null);
      }
      exec(`UPDATE answers SET other_brands = ? WHERE id = ?`, [
        JSON.stringify(other_brands),
        answerId,
      ]);
    });
    tx();
  } catch (err) {
    exec(`UPDATE answers SET error = ? WHERE id = ?`, [
      `extraction_failed: ${truncate(messageOf(err), 300)}`,
      answerId,
    ]);
  }

  return true;
}

/** Runs `worker` over `items` with at most `size` in flight. Never rejects. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch {
        // worker already records its own failures; a throw here must not stop the lane
      }
    }
  });
  await Promise.all(lanes);
}

function bumpCounts(runId: number, byProvider: Record<string, { ok: number; failed: number }>) {
  const ok = Object.values(byProvider).reduce((n, v) => n + v.ok, 0);
  const failed = Object.values(byProvider).reduce((n, v) => n + v.failed, 0);
  exec(`UPDATE runs SET ok_calls = ?, failed_calls = ? WHERE id = ?`, [ok, failed, runId]);
}

function finalize(runId: number, status: RunStatus, ok: number, failed: number) {
  exec(
    `UPDATE runs SET status = ?, ok_calls = ?, failed_calls = ?, finished_at = datetime('now') WHERE id = ?`,
    [status, ok, failed, runId]
  );
}

function safeAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** True when a run for this date already exists — guards double backfills. */
export function runExistsFor(runDate: string): boolean {
  return !!get<{ id: number }>(`SELECT id FROM runs WHERE run_date = ? LIMIT 1`, [runDate]);
}
