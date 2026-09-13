/**
 * Bridge between the worker and Workstream A's pipeline runner.
 *
 * The worker must boot and keep polling whether or not `src/pipeline/runner.ts`
 * exists yet, so the import is deferred and failure-tolerant: until A merges, a
 * stub records a run row and sleeps, which exercises the whole
 * request -> claim -> execute -> notify path end to end.
 *
 * When A's runner lands this file needs no edit — the dynamic import starts
 * resolving and the stub stops being reached.
 */
import { get, run } from '../lib/db';
import type { RunTrigger } from '../lib/types';
import { log } from './log';

/** What the worker needs back from a run, whoever executed it. */
export interface RunOutcome {
  runId: number;
  usedStub: boolean;
}

type UnknownRunner = (
  runDate: string,
  trigger: RunTrigger
) => Promise<unknown> | unknown;

let cached: UnknownRunner | null = null;
let warned = false;

/** Resolve A's executeRun, or null while `src/pipeline/runner.ts` is absent. */
async function resolveRunner(): Promise<UnknownRunner | null> {
  if (cached) return cached;
  try {
    // Indirect specifier: the module legitimately does not exist until
    // Workstream A merges, and a literal path would fail `tsc --noEmit`.
    const spec = '../pipeline/runner';
    const mod = (await import(spec)) as Record<string, unknown>;
    const fn = mod.executeRun;
    if (typeof fn !== 'function') {
      if (!warned) {
        log('run-bridge', 'src/pipeline/runner.ts exists but exports no executeRun — using stub');
        warned = true;
      }
      return null;
    }
    cached = fn as UnknownRunner;
    log('run-bridge', 'pipeline runner detected — real runs enabled');
    return cached;
  } catch {
    if (!warned) {
      log('run-bridge', 'pipeline runner not merged yet — using stub runner');
      warned = true;
    }
    return null;
  }
}

/**
 * A's runner may return a run id, a summary object, or nothing. Normalise it to
 * an id, falling back to the newest run row for that date so the worker always
 * has something to link to from Slack.
 */
function runIdFrom(result: unknown, runDate: string): number {
  if (typeof result === 'number' && Number.isFinite(result)) return result;
  if (result && typeof result === 'object') {
    const candidate = (result as { runId?: unknown; id?: unknown }).runId ??
      (result as { id?: unknown }).id;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  const row = get<{ id: number }>(
    `SELECT id FROM runs WHERE run_date = ? ORDER BY id DESC LIMIT 1`,
    [runDate]
  );
  return row?.id ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Placeholder run: real row, no LLM calls. Marked `partial` with zero calls so
 * nobody mistakes stub history for collected data on the Runs page.
 */
async function stubRun(runDate: string, trigger: RunTrigger): Promise<number> {
  const info = run(
    `INSERT INTO runs (run_date, trigger, status, total_calls, ok_calls, failed_calls)
     VALUES (?, ?, 'running', 0, 0, 0)`,
    [runDate, trigger]
  );
  const runId = Number(info.lastInsertRowid);
  await sleep(10_000);
  run(`UPDATE runs SET status = 'partial', finished_at = datetime('now') WHERE id = ?`, [runId]);
  return runId;
}

/** Execute a run for `runDate`, using A's runner when present. */
export async function executeRun(runDate: string, trigger: RunTrigger): Promise<RunOutcome> {
  const runner = await resolveRunner();
  if (!runner) {
    return { runId: await stubRun(runDate, trigger), usedStub: true };
  }
  const result = await runner(runDate, trigger);
  return { runId: runIdFrom(result, runDate), usedStub: false };
}

/** Today in the local timezone as YYYY-MM-DD, matching `runs.run_date`. */
export function today(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
