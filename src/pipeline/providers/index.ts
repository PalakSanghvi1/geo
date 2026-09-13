import { ANSWER_MODELS, RUNNER, type ModelChoice } from '../../lib/config';
import type { ProviderAnswer, ProviderId } from '../../lib/types';
import { askWithSearch as anthropicAsk } from './anthropic';
import { askWithSearch as openaiAsk } from './openai';
import { askWithSearch as geminiAsk } from './gemini';

const ADAPTERS: Record<ProviderId, (prompt: string, modelId: string) => Promise<ProviderAnswer>> = {
  anthropic: anthropicAsk,
  openai: openaiAsk,
  gemini: geminiAsk,
};

export function modelChoiceFor(provider: ProviderId): ModelChoice {
  const choice = ANSWER_MODELS.find((m) => m.provider === provider);
  if (!choice) throw new Error(`no model configured for provider ${provider}`);
  return choice;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number };
  return e?.status ?? e?.statusCode;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Timeouts, rate limits and server faults are worth another attempt; 400s are not. */
export function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status !== undefined) return false;
  return /timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(
    messageOf(err)
  );
}

/**
 * A stale model id is the one failure we can repair mid-flight, so detect it narrowly:
 * a 404, or a 4xx whose message actually talks about the model.
 */
export function isUnknownModel(err: unknown): boolean {
  const status = statusOf(err);
  const msg = messageOf(err);
  if (status === 404) return true;
  if (status === 400 && /model/i.test(msg) && /not.*(found|exist|support)|invalid|unknown/i.test(msg))
    return true;
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CallOutcome {
  answer: ProviderAnswer;
  /** true when the primary model id was rejected and we completed on the fallback. */
  usedFallback: boolean;
  attempts: number;
}

/**
 * One answer, with the whole recovery policy in a single place:
 *   - retry transient failures on the backoff schedule in config
 *   - switch to the fallback model id immediately (not after a wait) if the primary
 *     id is rejected, since retrying a bad id just burns the budget
 * Throws only when every avenue is exhausted; the runner turns that into a row.
 */
export async function callProvider(provider: ProviderId, prompt: string): Promise<CallOutcome> {
  const choice = modelChoiceFor(provider);
  const adapter = ADAPTERS[provider];

  let modelId = choice.primary;
  let usedFallback = false;
  let attempts = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= RUNNER.maxRetries; attempt++) {
    attempts++;
    try {
      return { answer: await adapter(prompt, modelId), usedFallback, attempts };
    } catch (err) {
      lastError = err;

      // Switching model id repairs two conditions, but only where the quota is scoped
      // to the model:
      //   - the primary id is rejected outright (any provider)
      //   - the primary is rate-limited AND quota is per-model-tier, which is true of
      //     Gemini (a Pro model out of quota says nothing about Flash) but NOT of
      //     Anthropic or OpenAI, where 429 is account-wide. Swapping model there just
      //     burns the fallback and retries into the same limit — which is exactly what
      //     happened during the first full backfill: gpt-5.6-terra 429'd, we fell back
      //     to gpt-5, and gpt-5 429'd too. Those providers must back off instead.
      const quotaIsPerModel = provider === 'gemini';
      if ((isUnknownModel(err) || (quotaIsPerModel && statusOf(err) === 429)) && !usedFallback) {
        modelId = choice.fallback;
        usedFallback = true;
        attempt--; // the swap is a repair, not a wasted attempt
        continue;
      }

      if (!isRetryable(err) || attempt === RUNNER.maxRetries) break;

      // Retries are the main hidden cost in a slow run: a throttled provider looks
      // identical to a slow one from the outside. Say so out loud.
      const schedule =
        statusOf(err) === 429 ? RUNNER.rateLimitBackoffMs : RUNNER.backoffMs;
      const base = schedule[Math.min(attempt, schedule.length - 1)];
      const wait = Math.round(base * (0.5 + Math.random())); // jitter, so lanes desynchronise
      console.warn(
        `  [retry] ${provider} ${modelId} status=${statusOf(err) ?? 'net'} ` +
          `attempt ${attempt + 1}/${RUNNER.maxRetries + 1} waiting ${wait}ms`
      );
      await sleep(wait);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
