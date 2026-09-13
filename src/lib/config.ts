import type { ProviderId } from './types';

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export interface ModelChoice {
  provider: ProviderId;
  /** Human label shown in the UI. */
  label: string;
  /** Exact API model id we want. */
  primary: string;
  /** Used automatically when `primary` is rejected as unknown at call time. */
  fallback: string;
}

/**
 * Verify these against the live model lists before the first real run:
 *   npm run verify-models
 * The runner falls back automatically on a model-not-found error, so a stale
 * primary degrades instead of failing the run.
 */
export const ANSWER_MODELS: ModelChoice[] = [
  {
    provider: 'anthropic',
    label: 'Claude Sonnet 5',
    primary: 'claude-sonnet-5',
    // Verified 2026-09-13 against the account's model list; claude-sonnet-4-5
    // (undated) is not a valid id there.
    fallback: 'claude-sonnet-4-6',
  },
  {
    provider: 'openai',
    label: 'GPT 5.6 Terra',
    primary: 'gpt-5.6-terra',
    fallback: 'gpt-5',
  },
  {
    provider: 'gemini',
    label: 'Gemini 3.1 Pro',
    // Verified 2026-09-13: 3.1 Pro is only published under the -preview id;
    // a bare `gemini-3.1-pro` does not resolve.
    primary: 'gemini-3.1-pro-preview',
    // gemini-2.5-pro and 2.5-flash appear in ListModels but 404 on generateContent
    // for this key. 3.5-flash is the best id that actually generates, and it also
    // has quota on the free tier, which the preview Pro model does not.
    fallback: 'gemini-3.5-flash',
  },
];

/** Cheap structured-output model used to extract mentions from an answer. */
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

/** Slightly larger model for narrative work (Notion takeaways, Linear scan). */
export const REASONING_MODEL = 'claude-sonnet-5';

/* ------------------------------------------------------------------ */
/* Runner tuning                                                       */
/* ------------------------------------------------------------------ */

export const RUNNER = {
  /**
   * Concurrent in-flight calls, PER PROVIDER — they do not share a rate limit and
   * must not share a number.
   *
   * Measured over a full 8-day backfill at a flat 8 lanes each: Anthropic retried 8
   * times, OpenAI retried 211 and degraded from 90/90 on the first day to 2/90 on the
   * last. That shape is a token bucket draining — a burst is allowed, then throttling
   * bites, and by then extra lanes are making things worse rather than faster. The
   * short single-run test that showed zero retries was too short to hit it, which is
   * why it looked like free headroom.
   */
  concurrencyPerProvider: {
    anthropic: 8,
    openai: 3,
    gemini: 4,
  } as Record<ProviderId, number>,
  /** Per-call timeout for an answer request. */
  answerTimeoutMs: 90_000,
  /** Retries after the first attempt, on timeout / 429 / 5xx. */
  maxRetries: 2,
  /** Backoff schedule between retries, for transient faults and timeouts. */
  backoffMs: [2_000, 8_000],
  /**
   * Rate limits need a different schedule. A token bucket refills on a timescale of
   * tens of seconds, so retrying after 2s just spends another request confirming the
   * bucket is still empty — and under concurrency, every lane does that at once.
   */
  rateLimitBackoffMs: [15_000, 45_000],
  /**
   * Max tokens per answer. Generous enough that a cited, multi-brand answer is
   * never truncated — a cut-off answer silently loses the brands named last,
   * which would corrupt position and visibility rather than just shortening text.
   */
  maxAnswerTokens: 4000,
} as const;

/** Visibility delta (percentage points vs the 7-day mean) that triggers an alert. */
export const ALERT_THRESHOLD_PTS = 5;

/** An untracked brand seen in at least this many answers becomes a "new competitor" signal. */
export const NEW_COMPETITOR_MIN_ANSWERS = 3;

/* ------------------------------------------------------------------ */
/* Project under test                                                  */
/* ------------------------------------------------------------------ */

export const PROJECT = {
  name: 'Lemma',
  domain: 'uselemma.ai',
  /** One-line context handed to the suggestion + narrative prompts. */
  context:
    'Lemma is a production monitoring and observability platform for AI agents. It audits every ' +
    'agent trace against the agent’s own instructions, groups recurring failures into issues, ' +
    'alerts teams in Slack, and creates online evals so regressions surface immediately. It sells ' +
    'to engineering teams shipping LLM agents to production.',
} as const;

export interface SeedBrand {
  name: string;
  isSelf?: boolean;
  aliases?: string[];
}

export const SEED_BRANDS: SeedBrand[] = [
  { name: 'Lemma', isSelf: true, aliases: ['uselemma', 'uselemma.ai', 'Lemma AI'] },
  { name: 'Raindrop', aliases: ['Raindrop AI'] },
  { name: 'LangSmith', aliases: ['Lang Smith', 'LangChain LangSmith'] },
  { name: 'Langfuse', aliases: ['Lang Fuse'] },
  { name: 'Braintrust', aliases: ['Braintrust Data', 'braintrust.dev'] },
  { name: 'Arize', aliases: ['Arize AI', 'Phoenix', 'Arize Phoenix'] },
  { name: 'Helicone', aliases: [] },
  { name: 'Weights & Biases Weave', aliases: ['W&B', 'Weave', 'wandb', 'Weights and Biases'] },
  { name: 'Galileo', aliases: ['Galileo AI', 'Rungalileo'] },
  { name: 'Datadog', aliases: ['Datadog LLM Observability', 'DataDog'] },
];

export interface SeedQuery {
  text: string;
  tag: string;
}

/** 15 base queries; seed.ts generates 2 variations of each (45 tracked prompts). */
export const SEED_QUERIES: SeedQuery[] = [
  { text: 'What are the best production monitoring tools for AI agents?', tag: 'category' },
  { text: 'How do I monitor my AI agent for failures in production?', tag: 'howto' },
  { text: 'LangSmith vs Langfuse vs Lemma — which should I use?', tag: 'comparison' },
  { text: 'Best LLM observability platforms in 2026', tag: 'category' },
  { text: 'What tools catch silent failures in AI agents?', tag: 'category' },
  { text: 'How do teams evaluate AI agent reliability in production?', tag: 'howto' },
  { text: 'Open source vs hosted LLM observability — what do you recommend?', tag: 'comparison' },
  { text: 'What’s the easiest way to add tracing to an AI agent?', tag: 'howto' },
  { text: 'Alternatives to LangSmith for agent monitoring', tag: 'comparison' },
  { text: 'Which AI agent monitoring tool has the best Slack alerting?', tag: 'feature' },
  // Branded queries. Real GEO customers track these alongside category questions,
  // and without them a young brand's visibility line is flat zero — true, but it
  // measures nothing and shows no movement.
  { text: 'What is Lemma and how does it monitor AI agents?', tag: 'branded' },
  { text: 'How do I know if my customer support AI agent is making mistakes?', tag: 'howto' },
  { text: 'Best observability stack for a YC startup building AI agents', tag: 'category' },
  { text: 'Lemma vs LangSmith for production agent monitoring', tag: 'branded' },
  { text: 'Datadog vs specialized AI agent monitoring tools', tag: 'comparison' },
];

/** Variations generated per base query at seed time (frozen afterwards). */
export const VARIATIONS_PER_QUERY = 2;

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

export const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'http://5.78.222.163/geo';

export const DATABASE_PATH = process.env.DATABASE_PATH ?? './data/geo.db';
