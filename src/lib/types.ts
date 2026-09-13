/**
 * Shared types. These mirror the SQLite schema in scripts/migrate.ts and are the
 * contract between all three workstreams — treat them as frozen after Phase 0.
 */

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

/**
 * 'synthetic' rows are FABRICATED, not collected. They exist so the trend chart has
 * depth before enough real days accumulate. They are tagged here, at the data layer,
 * so provenance travels with the row and no screen can present them as measurements
 * by accident. Everything else is a real provider response.
 */
export type RunTrigger = 'scheduled' | 'manual' | 'backfill' | 'synthetic';
// Which of these count as measurements is decided in one place: src/lib/provenance.ts.
export type RunStatus = 'running' | 'complete' | 'partial' | 'failed';
export type AnswerStatus = 'ok' | 'error';
export type SuggestionKind = 'query' | 'competitor';
export type SuggestionStatus = 'pending' | 'approved' | 'dismissed';
export type RunRequestStatus = 'pending' | 'picked_up' | 'done' | 'failed';

/** -1 negative, 0 neutral, +1 positive */
export type Sentiment = -1 | 0 | 1;

export interface Brand {
  id: number;
  name: string;
  is_self: 0 | 1;
  /** JSON array in the DB; parsed to string[] by the query helpers. */
  aliases: string[];
}

export interface Query {
  id: number;
  text: string;
  /** null = base query; set = a generated variation of that base query */
  parent_id: number | null;
  tag: string | null;
  active: 0 | 1;
}

export interface Run {
  id: number;
  run_date: string; // YYYY-MM-DD (simulated for backfill rows)
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  total_calls: number;
  ok_calls: number;
  failed_calls: number;
}

export interface Citation {
  url: string;
  title?: string;
  /**
   * true  = the model explicitly cited this URL in its answer text
   * false = the model retrieved it during search but did not cite it
   * This is the "cited vs used" distinction the sources view reports on.
   */
  cited?: boolean;
}

export interface Answer {
  id: number;
  run_id: number;
  query_id: number;
  provider: ProviderId;
  model_id: string;
  status: AnswerStatus;
  answer_text: string | null;
  citations: Citation[];
  /** Category-adjacent brands found in the answer that are NOT tracked yet. */
  other_brands: string[];
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface Mention {
  id: number;
  answer_id: number;
  brand_id: number;
  /** 1 = first tracked brand named in the answer */
  position: number;
  sentiment: Sentiment;
  quote: string | null;
}

export interface Suggestion {
  id: number;
  kind: SuggestionKind;
  text: string;
  rationale: string;
  source: string;
  status: SuggestionStatus;
  linear_issue_id: string | null;
  created_at: string;
}

export interface RunRequest {
  id: number;
  requested_by: string;
  note: string | null;
  status: RunRequestStatus;
  run_id: number | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Provider + extraction contracts (Workstream A internals)            */
/* ------------------------------------------------------------------ */

export interface ProviderAnswer {
  text: string;
  citations: Citation[];
  modelId: string;
  latencyMs: number;
}

export interface ExtractedMention {
  /** Must match a tracked brand name exactly as supplied to the extractor. */
  brand: string;
  order: number;
  sentiment: Sentiment;
  quote: string;
}

export interface ExtractionResult {
  mentions: ExtractedMention[];
  other_brands: string[];
}

/* ------------------------------------------------------------------ */
/* API response shapes (the contract Workstream B builds against)      */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  date: string;
  brand: string;
  visibility: number;
}

export interface ScoreboardRow {
  brand: string;
  isSelf: boolean;
  visibility: number;
  delta7: number;
  avgPosition: number | null;
  sentiment: number; // -100..100
}

export interface CoveragePoint {
  date: string;
  okPct: number;
}

/**
 * What the dataset actually is, as opposed to what the plan assumed it would be.
 *
 * Every field here exists because a screen was asserting something the data did not
 * support: a delta labelled "7-day" computed over one day, a model tab for a provider
 * that collected nothing, three months of trend line that is mostly fabricated. The UI
 * reads these rather than hardcoding the intended shape, so it degrades into telling
 * the truth instead of into being wrong.
 */
export interface DatasetShape {
  /** Run days present in the window. */
  runDays: number;
  /**
   * The day every headline figure is computed on: the newest MEASURED day in the
   * window, not the newest day.
   *
   * Those differ whenever illustrative filler is more recent than the last real
   * collection, which is the normal state between runs — and then the headline
   * visibility, position and sentiment were all read off a generated day. Four days
   * stale and real beats current and invented, so the date is carried here and shown.
   */
  headlineDate: string | null;
  /** True when `headlineDate` is also the newest day in the window, i.e. nothing newer is filler. */
  headlineIsCurrent: boolean;
  /**
   * The measured day `delta7` compares against, or null when no delta is shown.
   *
   * The delta only appears when the headline is current: a change between two stale
   * days decorates a number the reader has already been told is out of date, and the
   * gap between measured days is whatever collection happened to manage — never the
   * seven days the old label claimed.
   */
  deltaComparisonDate: string | null;
  /** Calendar days between `deltaComparisonDate` and `headlineDate`; null when suppressed. */
  deltaGapDays: number | null;
  /** Providers with at least one scored answer in the window, fabricated included — this drives the filter tabs. */
  providersWithData: ProviderId[];
  /**
   * Providers that returned an answer on a measured day. Distinct from the above because
   * a provider can be present entirely through illustrative rows, and crediting it with
   * collection it never performed is precisely the false claim this type exists to stop.
   */
  providersWithMeasuredData: ProviderId[];
  /**
   * Days backed by a real provider response — see `src/lib/provenance.ts`. `backfill`
   * counts: the date is simulated, but a model was genuinely asked and its citations
   * are real retrievals.
   */
  measuredDays: number;
  /** Days carried only by invented rows, which must never be read as measurement. */
  illustrativeDays: number;
  /**
   * Earliest day in the window collected ON the date it carries — `scheduled` or
   * `manual` only, so backfill is excluded here even though it counts as measured
   * above. The chart marks it as the boundary of genuine daily collection.
   */
  firstLiveDate: string | null;
}

export interface OverviewResponse {
  series: SeriesPoint[];
  scoreboard: ScoreboardRow[];
  coverage: CoveragePoint[];
  dataset: DatasetShape;
  /** Headline numbers for the self brand, for the stat cards. */
  self: {
    brand: string;
    visibility: number;
    delta7: number;
    avgPosition: number | null;
    sentiment: number;
    coverageToday: { ok: number; total: number };
  } | null;
}

export interface RunProviderCounts {
  provider: ProviderId;
  ok: number;
  failed: number;
  total: number;
}

/**
 * A run plus its real per-provider split.
 *
 * The split exists because the Runs page previously approximated it — dividing
 * `total_calls` evenly across providers and charging every failure to the last one.
 * That invented per-provider numbers on a page whose entire purpose is to report what
 * actually happened, so it is read from the answers table instead.
 */
export interface RunRow extends Run {
  byProvider: RunProviderCounts[];
}

export interface PromptRow {
  queryId: number;
  text: string;
  tag: string | null;
  isVariation: boolean;
  parentId: number | null;
  selfVisibility: number;
  topBrands: string[];
  latestAnswerIds: Partial<Record<ProviderId, number>>;
}

export interface AnswerDetailResponse {
  answer: Answer;
  queryText: string;
  runDate: string;
  mentions: Array<Mention & { brandName: string; isSelf: boolean }>;
}

export interface SourceRow {
  domain: string;
  citationCount: number;
  isCompetitorOwned: boolean;
  urls: Array<{ url: string; count: number }>;
}
