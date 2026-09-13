/**
 * Background worker (pm2: geo-worker).
 *
 * Three jobs:
 *   1. Slack Socket Mode bot — slash commands and outbound digests.
 *   2. node-cron — the daily run, the weekly Notion/Linear jobs, and an
 *      optional demo cadence.
 *   3. A 5-second poller over `run_requests`.
 *
 * Nothing here calls an LLM directly. Cron, the dashboard button and Slack all
 * insert a `run_requests` row; this poller is the only thing that executes a
 * run, so scheduled, manual and Slack-triggered runs share one code path.
 *
 * The process must never exit on its own — pm2 restarts it, but a crash loop
 * during the demo costs the Slack bot its connection. Every scheduled callback
 * and every poll is wrapped.
 */
import '../lib/env';
import cron from 'node-cron';
import { getDb, run as dbRun } from '../lib/db';
import type { RunRequest, RunTrigger } from '../lib/types';
import { notifyRunComplete, notifyRunFailed, queueRun, startSlack, stopSlack } from '../integrations/slack';
import { runLinearScan } from '../integrations/linear';
import { publishWeeklyReport } from '../integrations/notion';
import { executeRun, type RunSummary } from '../pipeline/runner';
import { log, logError } from './log';

const POLL_INTERVAL_MS = 5_000;

/**
 * The most recent Sunday strictly before today, as YYYY-MM-DD. The weekly report
 * runs on a Monday and covers the week that just ended, so it must not label
 * itself with the day it happens to run.
 */
function lastWeekEnding(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  // getUTCDay(): 0 = Sunday. Step back at least one day, then to that Sunday.
  const daysBack = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  local.setUTCDate(local.getUTCDate() - daysBack);
  return local.toISOString().slice(0, 10);
}

/** Today in the local timezone as YYYY-MM-DD, matching `runs.run_date`. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** One run at a time: 135 answer calls already saturate the provider budget. */
let running = false;
let shuttingDown = false;

/* ------------------------------------------------------------------ */
/* run_requests poller                                                 */
/* ------------------------------------------------------------------ */

/**
 * Claim the oldest pending request inside a transaction, so a second worker (or
 * a retry after a crash) can never pick up the same row twice.
 */
function claimNextRequest(): RunRequest | null {
  const db = getDb();
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, requested_by, note, status, run_id, created_at
           FROM run_requests
          WHERE status = 'pending'
          ORDER BY id
          LIMIT 1`
      )
      .get() as RunRequest | undefined;
    if (!row) return null;
    db.prepare(`UPDATE run_requests SET status = 'picked_up' WHERE id = ?`).run(row.id);
    return row;
  });
  return claim();
}

/** `cron` requests are the scheduled daily run; everything else is manual. */
function triggerFor(requestedBy: string): RunTrigger {
  return requestedBy === 'cron' ? 'scheduled' : 'manual';
}

async function processRequest(request: RunRequest): Promise<void> {
  const runDate = today();
  const trigger = triggerFor(request.requested_by);
  log(
    'poller',
    `request #${request.id} claimed (by ${request.requested_by}, trigger ${trigger})` +
      (request.note ? ` — "${request.note}"` : '')
  );

  try {
    const summary: RunSummary = await executeRun(runDate, trigger);
    dbRun(`UPDATE run_requests SET status = 'done', run_id = ? WHERE id = ?`, [
      summary.runId,
      request.id,
    ]);
    log(
      'poller',
      `request #${request.id} done → run #${summary.runId} ` +
        `(${summary.status}, ${summary.ok}/${summary.total} ok, ${Math.round(summary.elapsedMs / 1000)}s)`
    );

    // Every run that comes through the queue reports back to Slack with the
    // full digest. Backfill does not pass through here (it calls the runner
    // directly), so replaying history cannot spam the channel.
    await notifyRunComplete(summary.runId, request.requested_by, summary);
  } catch (error) {
    dbRun(`UPDATE run_requests SET status = 'failed' WHERE id = ?`, [request.id]);
    logError('poller', `request #${request.id} failed`, error);
    const reason = error instanceof Error ? error.message : String(error);
    await notifyRunFailed(request.requested_by, reason).catch(() => undefined);
  }
}

async function poll(): Promise<void> {
  if (running || shuttingDown) return;
  let request: RunRequest | null = null;
  try {
    request = claimNextRequest();
  } catch (error) {
    logError('poller', 'could not read run_requests', error);
    return;
  }
  if (!request) return;

  running = true;
  try {
    await processRequest(request);
  } finally {
    running = false;
  }
}

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

/** Wrap a cron callback so a thrown error can never kill the worker. */
function safeSchedule(expression: string, name: string, job: () => Promise<void>): void {
  if (!cron.validate(expression)) {
    logError('cron', `invalid expression for ${name}: "${expression}" — job not scheduled`);
    return;
  }
  cron.schedule(expression, () => {
    log('cron', `${name} fired`);
    job().catch((error) => logError('cron', `${name} failed`, error));
  });
  log('cron', `${name} scheduled (${expression})`);
}

function scheduleJobs(): void {
  // Daily run at 09:00 — queued, not executed, so it takes the same path as
  // a dashboard or Slack request.
  safeSchedule('0 9 * * *', 'daily run', async () => {
    const id = queueRun('cron', 'daily scheduled run');
    log('cron', `queued run_request #${id}`);
  });

  // Weekly jobs, Monday morning. Both are stubs until Phases C2 and C3.
  safeSchedule('0 9 * * 1', 'weekly Linear scan', async () => {
    const inserted = await runLinearScan();
    log('cron', `Linear scan inserted ${inserted} suggestion(s)`);
  });

  safeSchedule('0 10 * * 1', 'weekly Notion report', async () => {
    const weekEnding = lastWeekEnding();
    const url = await publishWeeklyReport(weekEnding);
    log(
      'cron',
      url
        ? `Notion report published for week ending ${weekEnding}: ${url}`
        : `Notion report skipped for week ending ${weekEnding}`
    );
  });

  // Demo mode: an extra run every N minutes so history moves during judging.
  const cadence = Number(process.env.DEMO_CADENCE_MINUTES ?? 0);
  if (Number.isFinite(cadence) && cadence > 0) {
    safeSchedule(`*/${Math.max(1, Math.floor(cadence))} * * * *`, 'demo cadence run', async () => {
      const id = queueRun('cron', 'demo cadence run');
      log('cron', `queued run_request #${id}`);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('worker', `${signal} received — shutting down`);
  await stopSlack().catch((error) => logError('worker', 'slack shutdown failed', error));
  process.exit(0);
}

async function main(): Promise<void> {
  // A crash here would take the Slack bot offline; log and keep serving.
  process.on('uncaughtException', (error) => logError('worker', 'uncaught exception', error));
  process.on('unhandledRejection', (reason) => logError('worker', 'unhandled rejection', reason));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const pending = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM run_requests WHERE status = 'pending'`)
    .get() as { n: number };
  log('worker', `up — ${pending.n} pending run request(s)`);

  // Cron and the poller start FIRST, and Slack is explicitly not awaited.
  //
  // Socket Mode does not reject when Slack is unreachable — @slack/socket-mode
  // retries the websocket with backoff, so `start()` can hang indefinitely rather
  // than fail. Awaiting it here would mean that losing outbound access to Slack at
  // boot silently leaves the worker with no cron and no poller, while pm2 still
  // reports it `online`. The dashboard's "Run now" and `/geo run` would queue
  // run_requests rows that nothing ever executes, with no error anywhere.
  //
  // Runs are the product; Slack is a notification channel. The product must come up
  // even when the notification channel cannot.
  scheduleJobs();

  setInterval(() => void poll(), POLL_INTERVAL_MS);
  log('worker', `polling run_requests every ${POLL_INTERVAL_MS / 1000}s`);

  void startSlack().catch((error) => {
    logError('worker', 'slack failed to start — continuing without it', error);
    return false;
  });
}

void main();
