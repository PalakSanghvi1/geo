/**
 * Mock data for the dashboard (Workstream B).
 *
 * Workstream A's API routes land at Checkpoint 2; until then the UI runs on
 * this module so layout, empty states and chart behaviour can be built and
 * reviewed against realistic shapes. Every export matches the frozen response
 * types in `./types` exactly — if a field here does not exist there, the mock
 * is wrong, not the contract.
 *
 * Mock mode is opt-in via NEXT_PUBLIC_USE_MOCK=1 (see src/app/_lib/fetcher.ts)
 * and the header shows a MOCK DATA badge while it is on, so a build on the VPS
 * can never quietly present invented numbers as measurements.
 */
import { ANSWER_MODELS, SEED_QUERIES } from './config';
import type {
  AnswerDetailResponse,
  Citation,
  CoveragePoint,
  OverviewResponse,
  PromptRow,
  ProviderId,
  Run,
  ScoreboardRow,
  Sentiment,
  SeriesPoint,
} from './types';

/** Park–Miller LCG: the same day always renders the same mock numbers. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Oldest first, matching `recentDates()` in src/lib/metrics.ts. */
export function mockDates(days = 14): string[] {
  return Array.from({ length: days }, (_, i) => isoDaysAgo(days - 1 - i));
}

/**
 * Where backfilled history stops and live runs begin. Real data derives this
 * from `runs.trigger`; the chart draws a dotted boundary there so nobody reads
 * simulated run-dates as seven days of genuine daily tracking.
 */
export function mockLiveFrom(): string {
  return isoDaysAgo(6);
}

interface MockBrand {
  brand: string;
  isSelf: boolean;
  /** Visibility at the start of the window, and today. */
  start: number;
  end: number;
  delta7: number;
  avgPosition: number;
  sentiment: number;
}

/** Ordered by today's visibility, which is how the scoreboard sorts. */
const BRANDS: MockBrand[] = [
  { brand: 'LangSmith', isSelf: false, start: 56, end: 54, delta7: -1.2, avgPosition: 1.8, sentiment: 48 },
  { brand: 'Langfuse', isSelf: false, start: 42, end: 43, delta7: 0.8, avgPosition: 2.6, sentiment: 55 },
  { brand: 'Lemma', isSelf: true, start: 27, end: 41, delta7: 4.2, avgPosition: 2.3, sentiment: 62 },
  { brand: 'Braintrust', isSelf: false, start: 33, end: 32, delta7: -0.4, avgPosition: 3.1, sentiment: 41 },
  { brand: 'Arize', isSelf: false, start: 25, end: 27, delta7: 1.1, avgPosition: 3.4, sentiment: 38 },
  { brand: 'Datadog', isSelf: false, start: 27, end: 24, delta7: -2.0, avgPosition: 2.9, sentiment: 22 },
  { brand: 'Raindrop', isSelf: false, start: 20, end: 22, delta7: 0.6, avgPosition: 3.8, sentiment: 44 },
  { brand: 'Helicone', isSelf: false, start: 19, end: 18, delta7: -0.5, avgPosition: 4.2, sentiment: 33 },
  { brand: 'Weights & Biases Weave', isSelf: false, start: 14, end: 15, delta7: 0.3, avgPosition: 4.6, sentiment: 29 },
  { brand: 'Galileo', isSelf: false, start: 12, end: 11, delta7: -0.7, avgPosition: 5.1, sentiment: 18 },
];

/** Providers see the category differently; used for the provider filter. */
const PROVIDER_BIAS: Record<string, number> = {
  all: 1,
  anthropic: 1.12,
  openai: 0.94,
  gemini: 0.88,
};

export function mockOverview(days = 14, provider = 'all'): OverviewResponse {
  const dates = mockDates(days);
  const bias = PROVIDER_BIAS[provider] ?? 1;
  const last = dates.length - 1;

  const series: SeriesPoint[] = [];
  for (const [i, b] of BRANDS.entries()) {
    const rand = seeded((i + 1) * 7919);
    for (const [d, date] of dates.entries()) {
      const trend = b.start + ((b.end - b.start) * d) / Math.max(1, last);
      // Today is pinned to the scoreboard value so the chart and the table agree.
      const value = d === last ? b.end * bias : (trend + (rand() - 0.5) * 3.6) * bias;
      series.push({ date, brand: b.brand, visibility: round1(Math.max(0, value)) });
    }
  }

  const scoreboard: ScoreboardRow[] = BRANDS.map((b) => ({
    brand: b.brand,
    isSelf: b.isSelf,
    visibility: round1(b.end * bias),
    delta7: b.delta7,
    avgPosition: b.avgPosition,
    sentiment: b.sentiment,
  })).sort((a, b) => b.visibility - a.visibility);

  // One backfill day degraded — the partial-run badge needs something to show.
  const partialDay = dates[Math.max(0, dates.length - 4)];
  const coverage: CoveragePoint[] = dates.map((date) => ({
    date,
    okPct: date === partialDay ? 95.6 : 100,
  }));

  const self = scoreboard.find((r) => r.isSelf) ?? null;

  return {
    series,
    scoreboard,
    coverage,
    self: self
      ? {
          brand: self.brand,
          visibility: self.visibility,
          delta7: self.delta7,
          avgPosition: self.avgPosition,
          sentiment: self.sentiment,
          coverageToday: { ok: 135, total: 135 },
        }
      : null,
  };
}

export function mockRuns(days = 14): Run[] {
  const dates = mockDates(days);
  const liveFrom = mockLiveFrom();

  const runs: Run[] = dates.map((run_date, i) => {
    const rand = seeded((i + 1) * 104729);
    const backfilled = run_date < liveFrom;
    const partial = i === dates.length - 4;
    const failed = partial ? 6 : 0;
    return {
      id: i + 1,
      run_date,
      trigger: backfilled ? 'backfill' : 'scheduled',
      status: partial ? 'partial' : 'complete',
      started_at: `${run_date} 06:00:00`,
      finished_at: `${run_date} 06:0${Math.floor(rand() * 3) + 7}:${Math.floor(rand() * 50) + 10}`,
      total_calls: 135,
      ok_calls: 135 - failed,
      failed_calls: failed,
    };
  });

  // The in-flight run at the top of the Runs page — what "Run now" produces.
  runs.push({
    id: dates.length + 1,
    run_date: dates[dates.length - 1],
    trigger: 'manual',
    status: 'running',
    started_at: `${dates[dates.length - 1]} 09:41:12`,
    finished_at: null,
    total_calls: 135,
    ok_calls: 87,
    failed_calls: 2,
  });

  return runs.reverse();
}

/* ------------------------------------------------------------------ */
/* Prompts (Phase B2)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Base query ids are 1..15, matching seed order. Variations of base `n` take
 * ids 15 + (n-1)*2 + 1 and +2, so a variation's parent is recoverable from its
 * id alone — handy while there is no database behind this.
 */
function variationIds(baseId: number): [number, number] {
  const first = SEED_QUERIES.length + (baseId - 1) * 2 + 1;
  return [first, first + 1];
}

const VARIATION_TEMPLATES: Array<(text: string) => string> = [
  (text) => `${text.replace(/\?$/, '')} — what do engineering teams actually use?`,
  (text) => `${text.replace(/\?$/, '')}, and which would you pick for a small team?`,
];

/** Answer ids encode their query and provider: queryId * 10 + provider slot. */
const PROVIDER_SLOT: Record<ProviderId, number> = { anthropic: 1, openai: 2, gemini: 3 };

export function mockAnswerId(queryId: number, provider: ProviderId): number {
  return queryId * 10 + PROVIDER_SLOT[provider];
}

function decodeAnswerId(answerId: number): { queryId: number; provider: ProviderId } {
  const slot = answerId % 10;
  const provider =
    (Object.keys(PROVIDER_SLOT) as ProviderId[]).find((p) => PROVIDER_SLOT[p] === slot) ??
    'anthropic';
  return { queryId: Math.floor(answerId / 10), provider };
}

function promptRow(queryId: number, text: string, tag: string, parentId: number | null): PromptRow {
  const rand = seeded(queryId * 2003);
  const ranked = [...BRANDS].sort(() => rand() - 0.5);
  return {
    queryId,
    text,
    tag,
    isVariation: parentId !== null,
    parentId,
    selfVisibility: round1(18 + rand() * 44),
    topBrands: ranked.slice(0, 3).map((b) => b.brand),
    latestAnswerIds: {
      anthropic: mockAnswerId(queryId, 'anthropic'),
      openai: mockAnswerId(queryId, 'openai'),
      gemini: mockAnswerId(queryId, 'gemini'),
    },
  };
}

/** 15 base queries plus two variations each — the 45 tracked prompts. */
export function mockPrompts(): PromptRow[] {
  const rows: PromptRow[] = [];
  for (const [i, query] of SEED_QUERIES.entries()) {
    const baseId = i + 1;
    rows.push(promptRow(baseId, query.text, query.tag, null));
    const [a, b] = variationIds(baseId);
    rows.push(promptRow(a, VARIATION_TEMPLATES[0](query.text), query.tag, baseId));
    rows.push(promptRow(b, VARIATION_TEMPLATES[1](query.text), query.tag, baseId));
  }
  return rows;
}

function queryTextFor(queryId: number): string {
  const base = SEED_QUERIES[queryId - 1];
  if (base) return base.text;
  const offset = queryId - SEED_QUERIES.length - 1;
  const parent = SEED_QUERIES[Math.floor(offset / 2)];
  if (!parent) return 'Unknown prompt';
  return VARIATION_TEMPLATES[offset % 2](parent.text);
}

/* ------------------------------------------------------------------ */
/* Answer detail (Phase B2)                                            */
/* ------------------------------------------------------------------ */

/** Brands named in the body, in the order they appear. Order drives `position`. */
const ANSWER_BRAND_ORDER = ['LangSmith', 'Langfuse', 'Lemma', 'Braintrust', 'Datadog'];

function answerBody(queryText: string): string {
  return [
    `The LLM observability space has matured quickly, and the right choice depends on whether you need framework-native tracing, open-source control, or agent-specific monitoring. LangSmith remains the default for teams building on LangChain — its tracing and evaluation tooling are deeply integrated, though it can feel heavy outside that ecosystem.`,
    `Langfuse is the strongest open-source option, with self-hosting, prompt management, and an active community. For teams running autonomous agents in production, Lemma takes a different approach: it audits every trace against the agent's instructions and surfaces failures you didn't define upfront, which reviewers consistently highlight for catching silent errors that never appear in error monitoring.`,
    `Braintrust focuses on evals and dataset iteration and pairs well with CI workflows, while Datadog makes sense if you already run its APM stack and want LLM traces beside your existing infrastructure dashboards.`,
    `For most agent-focused teams in 2026, a reasonable shortlist is LangSmith for LangChain shops, Langfuse for open-source control, and Lemma for production agent reliability. If your question is specifically "${queryText.replace(/\?$/, '')}", the answer is that the shortlist above covers the serious options.`,
  ].join('\n\n');
}

const MOCK_CITATIONS: Citation[] = [
  { url: 'https://www.g2.com/categories/llm-observability', title: 'LLM Observability — G2', cited: true },
  { url: 'https://www.g2.com/compare/langsmith-vs-langfuse', title: 'LangSmith vs Langfuse', cited: true },
  { url: 'https://langfuse.com/docs', title: 'Langfuse docs', cited: true },
  { url: 'https://www.latent.space/p/agent-observability', title: 'Agent observability', cited: true },
  { url: 'https://github.com/langfuse/langfuse', title: 'langfuse/langfuse', cited: false },
  { url: 'https://news.ycombinator.com/item?id=41234567', title: 'Show HN: agent monitoring', cited: false },
];

export function mockAnswerDetail(answerId: number): AnswerDetailResponse {
  const { queryId, provider } = decodeAnswerId(answerId);
  const rand = seeded(answerId * 7717);
  const model = ANSWER_MODELS.find((m) => m.provider === provider);
  const queryText = queryTextFor(queryId);
  const runDate = isoDaysAgo(0);

  const mentions = ANSWER_BRAND_ORDER.map((brand, i) => {
    const seed = BRANDS.find((b) => b.brand === brand);
    return {
      id: answerId * 10 + i,
      answer_id: answerId,
      brand_id: i + 1,
      position: i + 1,
      sentiment: (seed?.isSelf ? 1 : i % 2 === 0 ? 0 : 1) as Sentiment,
      quote: seed?.isSelf
        ? "surfaces failures you didn't define upfront, which reviewers consistently highlight for catching silent errors"
        : null,
      brandName: brand,
      isSelf: seed?.isSelf ?? false,
    };
  });

  return {
    answer: {
      id: answerId,
      run_id: 14,
      query_id: queryId,
      provider,
      model_id: model?.primary ?? 'unknown',
      status: 'ok',
      answer_text: answerBody(queryText),
      citations: MOCK_CITATIONS,
      other_brands: ['Traceloop', 'Openlayer'],
      latency_ms: Math.round(8000 + rand() * 9000),
      error: null,
      created_at: `${runDate} 09:04:11`,
    },
    queryText,
    runDate,
    mentions,
  };
}
