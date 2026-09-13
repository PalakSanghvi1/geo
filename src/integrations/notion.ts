/**
 * Notion integration — weekly visibility report published as a child page of
 * NOTION_PARENT_PAGE_ID (BUILD_PLAN §8 C3).
 *
 * Page shape:
 *   callout (headline stat) → QuickChart image → competitor scoreboard table →
 *   top cited sources → notable events → 3 narrative takeaways → dashboard link.
 *
 * Two rules this module exists to keep:
 *
 *  1. Every number comes from `src/lib/metrics.ts`. The dashboard, the Slack
 *     digest and this page must agree; nothing here recomputes visibility,
 *     position, sentiment or deltas.
 *  2. It never throws. This runs on a weekly cron inside the worker process —
 *     a missing token, an empty database, a Notion outage or a model hiccup all
 *     degrade to a log line and `null`, never to a dead worker.
 *
 * The narrative takeaways are the only part that may be missing from an
 * otherwise complete page: if the model call fails we publish without them.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Client, isFullPage } from '@notionhq/client';
import type { BlockObjectRequest } from '@notionhq/client';
import { PROJECT, PUBLIC_BASE_URL, REASONING_MODEL } from '../lib/config';
import { deltaLabel, providerList } from '../lib/labels';
import { getOverview, getSignals, getSources, recentDates } from '../lib/metrics';
import type { DigestSignal } from '../lib/metrics';
import type { OverviewResponse, ScoreboardRow, SourceRow } from '../lib/types';
import { log, logError } from '../worker/log';
import { buildVisibilityChartUrl, isChartUrlSafeLength } from './quickchart';

/** Days of history the report covers — matches the dashboard's default window. */
const REPORT_WINDOW_DAYS = 14;

/** Rows in the scoreboard table. Enough for the field, short enough to read. */
const MAX_SCOREBOARD_ROWS = 12;

/** Bullets in the "top cited sources" list. */
const MAX_SOURCE_BULLETS = 8;

/** BUILD_PLAN §8 C3 asks for exactly three narrative takeaways. */
const TAKEAWAY_COUNT = 3;

/**
 * Notion rejects a file/external URL longer than 2000 characters. A QuickChart
 * URL is a whole Chart.js config percent-encoded into a query string, so this
 * is a real ceiling, not a theoretical one — we shed competitor series until
 * the URL fits rather than publishing a page with a broken image.
 */
const NOTION_MAX_URL_LENGTH = 2000;

/** A cron job should give up on a hung API rather than pin a worker slot. */
const NOTION_TIMEOUT_MS = 30_000;

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_PARENT_PAGE_ID);
}

/* ------------------------------------------------------------------ */
/* Rich-text helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * The SDK does not re-export `RichTextItemRequest` from the package root, so
 * derive it from the block request union instead of hand-rolling a duplicate
 * that would drift from the real schema.
 */
type RichText = Extract<
  BlockObjectRequest,
  { paragraph: unknown }
>['paragraph']['rich_text'][number];

/** Notion caps a single rich-text item at 2000 characters. */
const MAX_RICH_TEXT = 2000;

/**
 * Truncate only — no whitespace normalisation. A rich-text run may deliberately
 * start or end with a space (they are concatenated into one paragraph) and may
 * contain a newline, which Notion renders as a line break.
 */
function clamp(text: string, limit = MAX_RICH_TEXT): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function rt(content: string): RichText[] {
  return [{ type: 'text', text: { content: clamp(content) } }];
}

/** Bold run followed by a plain run — used for the callout headline. */
function rtBoldThen(bold: string, rest: string): RichText[] {
  const items: RichText[] = [
    { type: 'text', text: { content: clamp(bold) }, annotations: { bold: true } },
  ];
  if (rest) items.push({ type: 'text', text: { content: clamp(rest) } });
  return items;
}

function rtLink(label: string, url: string): RichText[] {
  return [{ type: 'text', text: { content: clamp(label), link: { url } } }];
}

function paragraph(text: string): BlockObjectRequest {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } };
}

function italicParagraph(text: string): BlockObjectRequest {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: clamp(text) }, annotations: { italic: true } }],
    },
  };
}

function heading(text: string): BlockObjectRequest {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } };
}

function bullet(text: string): BlockObjectRequest {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: rt(text) },
  };
}

/* ------------------------------------------------------------------ */
/* Number formatting (display only — the values come from metrics.ts)  */
/* ------------------------------------------------------------------ */

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** "▲ 4.0 pts" / "▼ 2.5 pts" / "▪ 0.0 pts". */
function signedPts(n: number): string {
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '▪';
  return `${arrow} ${Math.abs(n).toFixed(1)} pts`;
}

function positionText(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function sentimentText(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

/** 'YYYY-MM-DD' → '13 Sep 2026'; falls back to the raw string. */
function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function reportTitle(weekEndingDate: string): string {
  return `${PROJECT.name} AI Visibility — Week ending ${weekEndingDate}`;
}

/* ------------------------------------------------------------------ */
/* Week aggregates                                                     */
/* ------------------------------------------------------------------ */

/**
 * Everything the page and the narrative prompt are built from, read once so
 * the blocks and the takeaways can never describe two different weeks.
 */
export interface WeekAggregates {
  weekEndingDate: string;
  /** Run dates with answers in the window, oldest first. Empty = no data yet. */
  dates: string[];
  overview: OverviewResponse;
  sources: SourceRow[];
  signals: DigestSignal[];
  /** QuickChart image URL, or null when there is no data (or it would not fit). */
  chartUrl: string | null;
}

/**
 * QuickChart never throws, but the URL it returns can exceed what Notion will
 * accept as an external image. Drop competitor series until it fits; give up
 * (and publish without the chart) rather than embed a URL Notion will reject.
 */
function chartUrlFor(overview: OverviewResponse): string | null {
  try {
    for (let competitorCount = 4; competitorCount >= 1; competitorCount -= 1) {
      const url = buildVisibilityChartUrl({
        series: overview.series,
        scoreboard: overview.scoreboard,
        competitorCount,
        title: `${PROJECT.name} AI visibility — last ${REPORT_WINDOW_DAYS} days`,
      });
      if (url.length <= NOTION_MAX_URL_LENGTH && isChartUrlSafeLength(url)) {
        if (competitorCount < 4) {
          log('notion', `chart trimmed to ${competitorCount} competitor(s) to fit the URL limit`);
        }
        return url;
      }
    }
    logError('notion', 'QuickChart URL too long for Notion even at 1 competitor — chart omitted');
    return null;
  } catch (error) {
    logError('notion', 'chart URL build failed — publishing without the chart', error);
    return null;
  }
}

/** Read the week once. Safe on an empty database: every field degrades to empty. */
export function gatherWeek(weekEndingDate: string): WeekAggregates {
  const dates = recentDates(REPORT_WINDOW_DAYS);
  const overview = getOverview(REPORT_WINDOW_DAYS, 'all');
  const sources = getSources(REPORT_WINDOW_DAYS, 'all');
  const signals = getSignals(REPORT_WINDOW_DAYS);

  return {
    weekEndingDate,
    dates,
    overview,
    sources,
    signals,
    chartUrl: dates.length > 0 ? chartUrlFor(overview) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Narrative takeaways                                                 */
/* ------------------------------------------------------------------ */

/**
 * A takeaway shorter than this is not a sentence — see MEASURED below.
 */
const MIN_TAKEAWAY_LENGTH = 40;

/**
 * One forced tool call is how the rest of this codebase gets reliable JSON out
 * of the model (see linear.ts) — a "reply with JSON only" prompt still fences
 * or prefaces the block often enough to matter on a weekly job nobody watches.
 *
 * MEASURED 2026-09-13: the obvious schema — `takeaways` as an array of plain
 * strings — degenerated to the literal `["takeaways"]` in 1 of 4 live calls on
 * this prompt. Wrapping each item in an object with a named `text` field fixed
 * it (8/8 clean). Keep the wrapper; the extra nesting is cheap insurance, and
 * `MIN_TAKEAWAY_LENGTH` below catches the failure if it ever returns.
 */
const TAKEAWAYS_TOOL: Anthropic.Tool = {
  name: 'record_takeaways',
  description:
    'Record the narrative takeaways for the weekly AI-visibility report. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      takeaways: {
        type: 'array',
        // No `maxItems` — the API rejects it on a `strict: true` schema. The
        // count is enforced by the prompt, this description and a slice().
        description: `Exactly ${TAKEAWAY_COUNT} takeaways, most important first.`,
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description:
                'One takeaway: a short paragraph of 1–2 full sentences of plain prose. No' +
                ' markdown, no bullet prefix, no heading, no label.',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['takeaways'],
    additionalProperties: false,
  },
  strict: true,
};

/** Plain-text digest of the week handed to the narrative model. */
export function buildTakeawaysPrompt(week: WeekAggregates): string {
  const { overview, sources, signals, dates } = week;
  const self = overview.self;

  const windowLine =
    dates.length > 0
      ? `${dates.length} run day(s), ${dates[0]} → ${dates[dates.length - 1]}`
      : 'no run days with answers yet';

  const scoreboardLines = overview.scoreboard
    .slice(0, MAX_SCOREBOARD_ROWS)
    .map(
      (row, index) =>
        `${index + 1}. ${row.brand}${row.isSelf ? ' (us)' : ''} — visibility ${pct(row.visibility)}, ` +
        `delta ${row.delta7 >= 0 ? '+' : ''}${row.delta7.toFixed(1)} pts ${deltaLabel(overview.deltaWindowDays)}, ` +
        `avg position ${positionText(row.avgPosition)}, sentiment ${sentimentText(row.sentiment)}`
    );

  const sourceLines = sources
    .slice(0, MAX_SOURCE_BULLETS)
    .map(
      (s) =>
        `- ${s.domain} — ${s.citationCount} citation(s)${s.isCompetitorOwned ? ' (competitor-owned)' : ''}`
    );

  return [
    `COMPANY CONTEXT (${PROJECT.name}, ${PROJECT.domain}):`,
    PROJECT.context,
    '',
    'WHAT THIS REPORT MEASURES:',
    `Every day we ask a fixed set of buyer questions to ${providerList(overview.providersWithData)} with live web`,
    'search, then extract every brand named in each answer. Visibility = the share of that day’s',
    'successful answers that mention a brand at least once. Position = the average order the brand',
    'is named in (1 = named first, lower is better). Sentiment = the average tone of the mentions,',
    `on a -100..+100 scale. The delta is the latest run day’s visibility minus the mean of the`,
    `${overview.deltaWindowDays} run day(s) before it, in percentage points.`,
    '',
    `WEEK ENDING ${week.weekEndingDate} (${windowLine}):`,
    self
      ? `${self.brand} visibility ${pct(self.visibility)}, delta ${self.delta7 >= 0 ? '+' : ''}${self.delta7.toFixed(1)} pts ${deltaLabel(overview.deltaWindowDays)}, ` +
        `avg position ${positionText(self.avgPosition)}, sentiment ${sentimentText(self.sentiment)}, ` +
        `coverage ${self.coverageToday.ok}/${self.coverageToday.total} answers on the latest run day.`
      : `No scored answers for ${PROJECT.name} in this window.`,
    '',
    'SCOREBOARD (all tracked brands, highest visibility first):',
    scoreboardLines.length > 0 ? scoreboardLines.join('\n') : '(no brands mentioned yet)',
    '',
    'TOP CITED SOURCE DOMAINS:',
    sourceLines.length > 0 ? sourceLines.join('\n') : '(no citations recorded yet)',
    '',
    'NOTABLE EVENTS DETECTED AUTOMATICALLY:',
    signals.length > 0 ? signals.map((s) => `- ${s.text}`).join('\n') : '(none)',
    '',
    'Write the weekly takeaways for the team.',
    '',
    'Rules:',
    `- Exactly ${TAKEAWAY_COUNT} takeaways, most important first.`,
    '- Each is one short paragraph of 1–2 sentences, plain prose, no markdown or bullet prefix.',
    '- Ground every claim in the numbers above. Never invent a figure, a brand or an event.',
    '- Say what it means and what to do about it, not just what the number is — the reader can',
    '  already see the table.',
    '- If the data is thin or empty, say so plainly rather than inventing a narrative.',
    '',
    'Call record_takeaways exactly once with your answer.',
  ].join('\n');
}

/**
 * Ask the reasoning model for the takeaways. Returns [] on any failure — the
 * page publishes without the narrative rather than not at all.
 */
export async function generateTakeaways(week: WeekAggregates): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    log('notion', 'ANTHROPIC_API_KEY not set — publishing without narrative takeaways');
    return [];
  }

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system:
        'You are a GEO (generative engine optimization) analyst writing the weekly visibility' +
        ' report for the team whose brand is being tracked. You are precise, quantitative and' +
        ' short. You answer only by calling the provided tool.',
      tools: [TAKEAWAYS_TOOL],
      // Forcing the tool is what makes the output reliably structured.
      tool_choice: { type: 'tool', name: TAKEAWAYS_TOOL.name },
      messages: [{ role: 'user', content: buildTakeawaysPrompt(week) }],
    });

    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TAKEAWAYS_TOOL.name
    );
    if (!block) {
      log('notion', `model returned no tool_use block (stop_reason ${message.stop_reason})`);
      return [];
    }

    const input = block.input as { takeaways?: unknown };
    if (!Array.isArray(input?.takeaways)) {
      log('notion', 'model tool input had no takeaways array');
      return [];
    }

    const takeaways = input.takeaways
      // Tolerate a bare string too, in case the model flattens the wrapper.
      .map((item) =>
        typeof item === 'string' ? item : ((item as { text?: unknown })?.text as string | undefined)
      )
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter((t) => t.length >= MIN_TAKEAWAY_LENGTH)
      .slice(0, TAKEAWAY_COUNT);

    if (takeaways.length < TAKEAWAY_COUNT) {
      log(
        'notion',
        `model returned ${takeaways.length} usable takeaway(s) of ${TAKEAWAY_COUNT} — publishing what it gave`
      );
    }
    return takeaways;
  } catch (error) {
    logError('notion', 'takeaway generation failed — publishing without it', error);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

function headlineCallout(week: WeekAggregates): BlockObjectRequest {
  const self = week.overview.self;

  if (!self) {
    return {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📭' },
        color: 'gray_background',
        rich_text: rtBoldThen(
          'No scored answers yet',
          ` — ${PROJECT.name}'s visibility will appear here once a run has collected answers.`
        ),
      },
    };
  }

  const rank = week.overview.scoreboard.findIndex((r) => r.isSelf) + 1;
  const detail =
    ` ${signedPts(self.delta7)} ${deltaLabel(week.overview.deltaWindowDays)}\n` +
    `Rank ${rank || '—'} of ${week.overview.scoreboard.length} tracked brands · ` +
    `avg position ${positionText(self.avgPosition)} · ` +
    `sentiment ${sentimentText(self.sentiment)} · ` +
    `${self.coverageToday.ok}/${self.coverageToday.total} answers collected`;

  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: self.delta7 >= 0 ? '📈' : '📉' },
      color: self.delta7 >= 0 ? 'green_background' : 'orange_background',
      rich_text: rtBoldThen(`Visibility ${pct(self.visibility)}`, detail),
    },
  };
}

function scoreboardTable(
  scoreboard: ScoreboardRow[],
  deltaWindowDays: number
): BlockObjectRequest {
  const header: BlockObjectRequest = {
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        rt('Brand'),
        rt('Visibility'),
        rt(`Δ ${deltaLabel(deltaWindowDays)}`),
        rt('Avg position'),
        rt('Sentiment'),
      ],
    },
  };

  const rows: BlockObjectRequest[] = scoreboard.slice(0, MAX_SCOREBOARD_ROWS).map((row) => ({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        rt(row.isSelf ? `${row.brand} (us)` : row.brand),
        rt(pct(row.visibility)),
        rt(signedPts(row.delta7)),
        rt(positionText(row.avgPosition)),
        rt(sentimentText(row.sentiment)),
      ],
    },
  }));

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: 5,
      has_column_header: true,
      has_row_header: false,
      // A `table` must carry its rows as children in the same request — Notion
      // rejects a table block with an empty children array.
      children: [header, ...rows] as Extract<
        BlockObjectRequest,
        { table: unknown }
      >['table']['children'],
    },
  };
}

/**
 * The full page body. Pure: no network, no Notion client — print it to verify
 * the block shapes without creating anything.
 *
 * `takeaways` may be empty; the section is then omitted entirely.
 */
export function buildReportBlocks(week: WeekAggregates, takeaways: string[]): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  const { overview, sources, signals, dates } = week;

  /* 1. Headline callout. */
  blocks.push(headlineCallout(week));
  blocks.push(
    italicParagraph(
      dates.length > 0
        ? `Window: ${dates.length} run day(s), ${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])}. ` +
          'WoW compares the latest run day against the mean of the seven run days before it. ' +
          'All figures come from the same metrics module as the dashboard and the Slack digest.'
        : 'No runs with collected answers yet, so this report has no numbers to show.'
    )
  );

  /* 2. Chart. */
  blocks.push(heading('Visibility trend'));
  if (week.chartUrl) {
    blocks.push({
      object: 'block',
      type: 'image',
      image: {
        type: 'external',
        external: { url: week.chartUrl },
        caption: rt(
          `Daily visibility, last ${REPORT_WINDOW_DAYS} run days — ${PROJECT.name} and its closest competitors.`
        ),
      },
    });
  } else {
    blocks.push(paragraph('No chart this week — there is no daily visibility history to plot yet.'));
  }

  /* 3. Competitor scoreboard. */
  blocks.push(heading('Competitor scoreboard'));
  if (overview.scoreboard.length > 0) {
    blocks.push(scoreboardTable(overview.scoreboard, overview.deltaWindowDays));
  } else {
    blocks.push(paragraph('No brand has been mentioned in a collected answer yet.'));
  }

  /* 4. Top cited sources. */
  blocks.push(heading('Top cited sources'));
  if (sources.length > 0) {
    for (const source of sources.slice(0, MAX_SOURCE_BULLETS)) {
      blocks.push(
        bullet(
          `${source.domain} — ${source.citationCount} citation(s)` +
            (source.isCompetitorOwned ? ' · competitor-owned' : '')
        )
      );
    }
  } else {
    blocks.push(paragraph('No citations recorded in this window.'));
  }

  /* 5. Notable events. */
  blocks.push(heading('Notable events'));
  if (signals.length > 0) {
    for (const signal of signals) blocks.push(bullet(signal.text));
  } else {
    blocks.push(
      bullet('Nothing unusual — no big swings, no new competitors, no provider disagreement.')
    );
  }

  /* 6. Narrative takeaways (omitted entirely if the model call failed). */
  if (takeaways.length > 0) {
    blocks.push(heading('Takeaways'));
    for (const takeaway of takeaways.slice(0, TAKEAWAY_COUNT)) blocks.push(paragraph(takeaway));
  }

  /* 7. Closing link back to the live dashboard. */
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        ...rt('Live numbers, per-answer detail and run history: '),
        ...rtLink(PUBLIC_BASE_URL, PUBLIC_BASE_URL),
      ],
    },
  });

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Publish                                                             */
/* ------------------------------------------------------------------ */

/** Fallback page URL when Notion answers with a partial page object. */
function pageUrlFallback(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, '')}`;
}

/**
 * Publish the report for the week ending `weekEndingDate` (YYYY-MM-DD) as a
 * child page of NOTION_PARENT_PAGE_ID. Returns the new page URL, or null when
 * anything at all went wrong (the caller logs and carries on).
 */
export async function publishWeeklyReport(weekEndingDate: string): Promise<string | null> {
  if (!isNotionConfigured()) {
    log('notion', 'NOTION_TOKEN / NOTION_PARENT_PAGE_ID not set — publish skipped');
    return null;
  }

  try {
    const week = gatherWeek(weekEndingDate);
    if (week.dates.length === 0) {
      log('notion', `no run days with answers — publishing an empty-week report for ${weekEndingDate}`);
    }

    const takeaways = await generateTakeaways(week);
    const children = buildReportBlocks(week, takeaways);

    const notion = new Client({
      auth: process.env.NOTION_TOKEN,
      timeoutMs: NOTION_TIMEOUT_MS,
    });

    const page = await notion.pages.create({
      parent: { type: 'page_id', page_id: process.env.NOTION_PARENT_PAGE_ID as string },
      icon: { type: 'emoji', emoji: '📊' },
      properties: {
        // A page under a page has exactly one property: its title.
        title: { title: rt(reportTitle(weekEndingDate)) },
      },
      children,
    });

    const url = isFullPage(page) ? page.url : pageUrlFallback(page.id);
    log(
      'notion',
      `published week ending ${weekEndingDate} — ${children.length} block(s), ` +
        `${takeaways.length} takeaway(s): ${url}`
    );
    return url;
  } catch (error) {
    logError('notion', `weekly report failed for week ending ${weekEndingDate}`, error);
    return null;
  }
}
