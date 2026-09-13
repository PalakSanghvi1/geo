/**
 * Slack integration — Socket Mode, so the worker needs no public URL and works
 * identically on a laptop and on the VPS.
 *
 * Phase C1 surface:
 *   /geo ping           health check
 *   /geo run [note]     queue a run via run_requests (same path as cron + dashboard)
 *   /geo status         today's headline numbers
 * plus run completion/failure messages posted back to SLACK_CHANNEL_ID.
 *
 * Phase C2 adds the Block Kit daily digest (buildDigest / postDigest). Every
 * number in it comes from src/lib/metrics.ts — the dashboard, this digest and
 * the Notion report must never compute visibility independently.
 */
import { App, LogLevel } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { PROJECT, PUBLIC_BASE_URL } from '../lib/config';
import { get, run } from '../lib/db';
import { getOverview, getSignals, recentDates } from '../lib/metrics';
import { today } from '../worker/run-bridge';
import { log, logError } from '../worker/log';

let app: App | null = null;
let started = false;

/** True when every token the bot needs is present. */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN);
}

function channelId(): string | undefined {
  return process.env.SLACK_CHANNEL_ID || undefined;
}

/* ------------------------------------------------------------------ */
/* Run requests                                                        */
/* ------------------------------------------------------------------ */

/**
 * Queue a run. The web app, the cron schedule and Slack all funnel through this
 * table so scheduled, manual and Slack-triggered runs share one code path.
 */
export function queueRun(requestedBy: string, note?: string): number {
  const info = run(
    `INSERT INTO run_requests (requested_by, note, status) VALUES (?, ?, 'pending')`,
    [requestedBy, note?.trim() ? note.trim() : null]
  );
  return Number(info.lastInsertRowid);
}

/* ------------------------------------------------------------------ */
/* Message bodies                                                      */
/* ------------------------------------------------------------------ */

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function signed(n: number): string {
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '▪';
  return `${arrow} ${Math.abs(n).toFixed(1)} pts`;
}

/** One-line answer for `/geo status`. */
export function buildStatusLine(): string {
  const overview = getOverview(14, 'all');
  const self = overview.self;
  if (!self) {
    return 'No runs recorded yet — trigger one with `/geo run`.';
  }
  const rank = overview.scoreboard.findIndex((r) => r.isSelf) + 1;
  const coverage = self.coverageToday;
  const coverageText =
    coverage.total > 0 ? `${coverage.ok}/${coverage.total} answers collected` : 'no answers today';
  return (
    `*${self.brand}* — visibility ${pct(self.visibility)} (${signed(self.delta7)} vs 7-day avg), ` +
    `rank ${rank || '—'} of ${overview.scoreboard.length}, ` +
    `avg position ${self.avgPosition === null ? '—' : self.avgPosition.toFixed(1)}, ` +
    `sentiment ${self.sentiment > 0 ? '+' : ''}${self.sentiment}. ${coverageText}.`
  );
}

interface RunRow {
  id: number;
  run_date: string;
  status: string;
  total_calls: number;
  ok_calls: number;
  failed_calls: number;
}

/**
 * Compact completion summary. Run completions now post the full digest (see
 * notifyRunComplete); this stays available for anywhere a short body is wanted.
 */
export function buildRunCompleteBlocks(runId: number, requestedBy: string): KnownBlock[] {
  const row = get<RunRow>(
    `SELECT id, run_date, status, total_calls, ok_calls, failed_calls FROM runs WHERE id = ?`,
    [runId]
  );
  const overview = getOverview(14, 'all');
  const self = overview.self;

  const lines: string[] = [];
  if (self) {
    lines.push(
      `*${self.brand}* visibility *${pct(self.visibility)}*  (${signed(self.delta7)} vs 7-day average)`
    );
    const movers = overview.scoreboard
      .filter((r) => !r.isSelf)
      .sort((a, b) => Math.abs(b.delta7) - Math.abs(a.delta7));
    const mover = movers[0];
    if (mover && Math.abs(mover.delta7) >= 0.1) {
      lines.push(`Biggest mover: *${mover.brand}* ${signed(mover.delta7)} → ${pct(mover.visibility)}`);
    }
  } else {
    lines.push('Run finished, but there are no scored answers yet.');
  }
  if (row) {
    const coverage =
      row.total_calls > 0
        ? `${row.ok_calls}/${row.total_calls} answers collected${row.failed_calls ? ` · ${row.failed_calls} failed` : ''}`
        : 'no answer calls recorded';
    lines.push(`Coverage: ${coverage} · status \`${row.status}\``);
  }

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Run #${runId} complete`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Requested by ${requestedBy} · <${PUBLIC_BASE_URL}/runs|Open the runs page>`,
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Daily digest (Phase C2)                                             */
/* ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' → 'Sat 13 Sep 2026'; falls back to the raw string. */
function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Coverage fallback for days where no answer has been scored yet (so
 * `overview.self` is null): read the run rows' own call counters.
 */
function runCoverageFor(date: string): { ok: number; total: number } {
  const row = get<{ ok: number | null; total: number | null }>(
    `SELECT SUM(ok_calls) AS ok, SUM(total_calls) AS total FROM runs WHERE run_date = ?`,
    [date]
  );
  return { ok: row?.ok ?? 0, total: row?.total ?? 0 };
}

function coverageLine(ok: number, total: number): string {
  if (total <= 0) return ':warning: No answers collected yet for this date.';
  const emoji = ok >= total ? ':white_check_mark:' : ':warning:';
  const pctOk = Math.round((ok / total) * 100);
  const shortfall = ok >= total ? '' : ` (${pctOk}% coverage — ${total - ok} call(s) failed)`;
  return `${ok}/${total} answers collected${shortfall} ${emoji}`;
}

function section(text: string): KnownBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function context(text: string): KnownBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function buildDigestBlocks(date?: string): KnownBlock[] {
  const latest = recentDates(1)[0] ?? null;
  const target = date ?? latest ?? today();

  const overview = getOverview(14, 'all');
  const self = overview.self;
  const brand = self?.brand ?? PROJECT.name;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 ${brand} AI visibility — ${formatDate(target)}`, emoji: true },
    },
  ];

  // 1. Headline: visibility and the delta against the 7-day average.
  if (self) {
    const rank = overview.scoreboard.findIndex((r) => r.isSelf) + 1;
    blocks.push(
      section(
        `*Visibility ${pct(self.visibility)}*  ${signed(self.delta7)} vs 7-day average\n` +
          `Rank *${rank || '—'}* of ${overview.scoreboard.length} tracked brands · ` +
          `avg position ${self.avgPosition === null ? '—' : self.avgPosition.toFixed(1)} · ` +
          `sentiment ${self.sentiment > 0 ? '+' : ''}${self.sentiment}`
      )
    );
  } else {
    blocks.push(
      section(
        `*No scored answers yet.*\n${brand}'s visibility will appear here after the first run finishes — queue one with \`/geo run\`.`
      )
    );
  }

  // 2. Notable events — computed once, in metrics.ts, for every surface.
  const signals = getSignals(14);
  blocks.push(
    section(
      signals.length > 0
        ? `*Notable events*\n${signals.map((s) => `• ${s.text}`).join('\n')}`
        : '*Notable events*\n• Nothing unusual — no big swings, no new competitors, no provider disagreement.'
    )
  );

  // 3. Top 3 competitors, one line.
  const competitors = overview.scoreboard.filter((r) => !r.isSelf).slice(0, 3);
  blocks.push(
    section(
      competitors.length > 0
        ? `*Top competitors:* ${competitors
            .map((c) => `${c.brand} ${pct(c.visibility)} (${signed(c.delta7)})`)
            .join(' · ')}`
        : '*Top competitors:* none mentioned yet.'
    )
  );

  // 4. Coverage.
  const coverage =
    self && self.coverageToday.total > 0 ? self.coverageToday : runCoverageFor(target);
  blocks.push(context(`Coverage: ${coverageLine(coverage.ok, coverage.total)}`));

  // 5. Dashboard link (plus an honesty note when the numbers are not the
  //    requested day's — metrics always report the latest day with answers).
  if (date && latest && date !== latest) {
    blocks.push(context(`_Numbers above are from the latest run date (${latest})._`));
  }
  blocks.push(section(`<${PUBLIC_BASE_URL}|Open the GEO dashboard> · <${PUBLIC_BASE_URL}/runs|Run history>`));

  return blocks;
}

/**
 * The daily digest as Block Kit blocks. `date` only labels the digest; the
 * numbers always come from metrics.ts's latest day with answers (and a note is
 * added when those differ). Never throws — Slack must not be able to break a run.
 */
export function buildDigest(date?: string): KnownBlock[] {
  try {
    return buildDigestBlocks(date);
  } catch (error) {
    logError('slack', 'digest build failed — posting a minimal body', error);
    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📊 ${PROJECT.name} AI visibility`, emoji: true },
      },
      section(
        `Could not read the metrics database just now.\n<${PUBLIC_BASE_URL}|Open the GEO dashboard>`
      ),
    ];
  }
}

/** Plain-text notification fallback for the digest (used as Slack's `text`). */
export function buildDigestText(date?: string): string {
  try {
    const target = date ?? recentDates(1)[0] ?? today();
    return `GEO daily digest — ${target}: ${buildStatusLine()}`;
  } catch {
    return 'GEO daily digest';
  }
}

/* ------------------------------------------------------------------ */
/* Outbound posts                                                      */
/* ------------------------------------------------------------------ */

/**
 * Post to the digest channel. Never throws — a Slack outage must not fail a run
 * or take the worker down with it.
 */
export async function postToChannel(text: string, blocks?: KnownBlock[]): Promise<boolean> {
  const channel = channelId();
  if (!app || !channel) {
    log('slack', `not posting (${!app ? 'bot not started' : 'SLACK_CHANNEL_ID unset'})`);
    return false;
  }
  try {
    await app.client.chat.postMessage({ channel, text, blocks, unfurl_links: false });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not_in_channel')) {
      logError('slack', `bot is not a member of ${channel} — run /invite @geo in that channel`);
    } else {
      logError('slack', 'chat.postMessage failed', error);
    }
    return false;
  }
}

/** Post the daily digest. Returns false when Slack is not configured/reachable. */
export async function postDigest(date?: string): Promise<boolean> {
  try {
    return await postToChannel(buildDigestText(date), buildDigest(date));
  } catch (error) {
    logError('slack', 'postDigest failed', error);
    return false;
  }
}

/**
 * A completed run posts the full digest plus a one-line context footer naming
 * the run and whoever asked for it.
 */
export async function notifyRunComplete(runId: number, requestedBy: string): Promise<void> {
  try {
    const blocks = buildDigest();
    blocks.push(context(runFooter(runId, requestedBy)));
    await postToChannel(`Run #${runId} complete — ${buildDigestText()}`, blocks);
  } catch (error) {
    logError('slack', `notifyRunComplete(${runId}) failed`, error);
  }
}

/** "Posted after run #12 (manual, 135/135 ok) · requested by slack:U123 · <link>". */
function runFooter(runId: number, requestedBy: string): string {
  let detail = '';
  try {
    const row = get<RunRow>(
      `SELECT id, run_date, status, total_calls, ok_calls, failed_calls FROM runs WHERE id = ?`,
      [runId]
    );
    if (row) {
      detail =
        ` (${row.status}` +
        (row.total_calls > 0 ? `, ${row.ok_calls}/${row.total_calls} answers` : '') +
        `)`;
    }
  } catch (error) {
    logError('slack', `could not read run #${runId} for the digest footer`, error);
  }
  return `Posted after run #${runId}${detail} · requested by ${requestedBy} · <${PUBLIC_BASE_URL}/runs|Open the runs page>`;
}

export async function notifyRunFailed(requestedBy: string, reason: string): Promise<void> {
  await postToChannel(
    `Run failed: ${reason}`,
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Run failed* — ${reason}\nRequested by ${requestedBy}. See \`pm2 logs geo-worker\`.`,
        },
      },
    ]
  );
}

/* ------------------------------------------------------------------ */
/* Command handling                                                    */
/* ------------------------------------------------------------------ */

const HELP = [
  '*GEO commands*',
  '`/geo ping` — check the bot is alive',
  '`/geo run [note]` — queue a fresh run across Claude, GPT and Gemini',
  '`/geo status` — today’s visibility numbers',
].join('\n');

interface CommandReply {
  text: string;
  inChannel: boolean;
}

/**
 * Pure command router — no Slack types in the signature, so the behaviour is
 * testable and shared between the slash command and @-mentions.
 */
export function handleCommandText(raw: string, userId: string): CommandReply {
  const trimmed = (raw ?? '').trim();
  const [sub = '', ...rest] = trimmed.split(/\s+/);
  const note = rest.join(' ');

  switch (sub.toLowerCase()) {
    case 'ping':
      return { text: 'pong 🏓', inChannel: true };

    case 'run': {
      const requestedBy = `slack:${userId}`;
      const requestId = queueRun(requestedBy, note);
      log('slack', `queued run_request #${requestId} for ${requestedBy}`);
      return {
        text:
          `🔎 Run queued — I'll post results here.` +
          (note ? `\n> ${note}` : '') +
          `\n_Request #${requestId}._`,
        inChannel: true,
      };
    }

    case 'status':
      try {
        return { text: buildStatusLine(), inChannel: true };
      } catch (error) {
        logError('slack', 'status query failed', error);
        return { text: 'Could not read the database just now — try again shortly.', inChannel: false };
      }

    case '':
    case 'help':
      return { text: HELP, inChannel: false };

    default:
      return { text: `Unknown command \`${sub}\`.\n\n${HELP}`, inChannel: false };
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

function build(): App {
  const instance = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  instance.command('/geo', async ({ command, ack, respond }) => {
    await ack();
    try {
      const reply = handleCommandText(command.text, command.user_id);
      await respond({
        text: reply.text,
        response_type: reply.inChannel ? 'in_channel' : 'ephemeral',
      });
    } catch (error) {
      logError('slack', `/geo ${command.text} failed`, error);
      await respond({ text: 'Something broke handling that command.', response_type: 'ephemeral' });
    }
  });

  // @-mention fallback, so the demo still works if the slash command misfires.
  instance.event('app_mention', async ({ event, say }) => {
    try {
      const withoutMention = event.text.replace(/<@[^>]+>/g, '').trim();
      const reply = handleCommandText(withoutMention, event.user ?? 'unknown');
      await say({ text: reply.text, thread_ts: event.ts });
    } catch (error) {
      logError('slack', 'app_mention failed', error);
    }
  });

  instance.error(async (error) => {
    logError('slack', 'unhandled bolt error', error);
  });

  return instance;
}

/** Start the Socket Mode bot. Returns false when tokens are missing. */
export async function startSlack(): Promise<boolean> {
  if (started) return true;
  if (!isSlackConfigured()) {
    log('slack', 'SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set — Slack disabled');
    return false;
  }
  app = build();
  await app.start();
  started = true;
  const channel = channelId();
  log('slack', `socket mode connected${channel ? `, digests → ${channel}` : ', no digest channel set'}`);
  return true;
}

export async function stopSlack(): Promise<void> {
  if (app && started) {
    await app.stop();
    started = false;
  }
}
