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
 * The richer Block Kit daily digest lands in Phase C2 (buildDigest).
 */
import { App, LogLevel } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { PUBLIC_BASE_URL } from '../lib/config';
import { get, run } from '../lib/db';
import { getOverview } from '../lib/metrics';
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

/** Short completion summary. Phase C2 replaces this with the full digest. */
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

export async function notifyRunComplete(runId: number, requestedBy: string): Promise<void> {
  await postToChannel(
    `Run #${runId} complete`,
    buildRunCompleteBlocks(runId, requestedBy)
  );
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
