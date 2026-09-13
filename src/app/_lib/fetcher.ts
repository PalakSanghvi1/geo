'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnswerDetailResponse,
  EvalSummary,
  OverviewResponse,
  PromptRow,
  RunRow,
  SourceRow,
  Suggestion,
} from '@/lib/types';

/**
 * Mirrors `basePath` in next.config.ts. Browser fetches are not rewritten by
 * Next, so the base path has to be spelled out here — nginx only proxies /geo.
 */
export const API_BASE = '/geo/api';

export type ProviderParam = 'all' | 'anthropic' | 'openai' | 'gemini';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response for the current key. Polling stays quiet. */
  loading: boolean;
  refresh: () => void;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `${res.status} ${res.statusText}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/**
 * `key` identifies the request: when it changes the view resets to its loading
 * state, when only `tick` changes (polling, manual refresh) the previous data
 * stays on screen so a five-second poll doesn't strobe the page.
 */
function useResource<T>(key: string, load: () => Promise<T>, pollMs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Kept in a ref so an inline arrow for `load` doesn't retrigger the effect.
  // Assigned in an effect rather than during render, which concurrent rendering
  // is free to throw away.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  // Declared after the fetch effect so the request is already in flight.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading: data === null && error === null, refresh };
}

export function useOverview(days: number, provider: ProviderParam): AsyncState<OverviewResponse> {
  return useResource(`overview:${days}:${provider}`, () =>
    getJson<OverviewResponse>(`/overview?days=${days}&provider=${provider}`)
  );
}

export function useRuns(pollMs = 0): AsyncState<RunRow[]> {
  return useResource('runs', () => getJson<RunRow[]>('/runs'), pollMs);
}

export function useEval(): AsyncState<EvalSummary | null> {
  return useResource('eval', () => getJson<EvalSummary | null>('/eval'));
}

export function usePrompts(): AsyncState<PromptRow[]> {
  return useResource('prompts', () => getJson<PromptRow[]>('/prompts'));
}

export function useAnswerDetail(answerId: number): AsyncState<AnswerDetailResponse> {
  return useResource(`answer:${answerId}`, () =>
    getJson<AnswerDetailResponse>(`/answers/${answerId}`)
  );
}

export function useSources(days: number, provider: ProviderParam): AsyncState<SourceRow[]> {
  return useResource(`sources:${days}:${provider}`, () =>
    getJson<SourceRow[]>(`/sources?days=${days}&provider=${provider}`)
  );
}

/** Pending suggestions only — the API does not return resolved ones. */
export function useSuggestions(): AsyncState<Suggestion[]> {
  return useResource('suggestions', () => getJson<Suggestion[]>('/suggestions'));
}

/**
 * Queues a run. Everything that starts work — cron, Slack, this button — goes
 * through `run_requests`, so the worker has one code path to poll.
 */
export async function triggerRun(note: string): Promise<void> {
  await postJson('/trigger', { note });
}

export interface SuggestionActionResult {
  suggestion: Suggestion;
  /** What approving inserted, if anything. `duplicate` means it already existed. */
  created?: { table: 'queries' | 'brands' | null; id: number | null; duplicate: boolean };
}

export async function resolveSuggestion(
  id: number,
  action: 'approve' | 'dismiss'
): Promise<SuggestionActionResult> {
  return postJson<SuggestionActionResult>('/suggestions', { id, action });
}

/**
 * BUILD_PLAN section 7 puts push-to-linear on this endpoint, but the route
 * currently accepts only 'approve' | 'dismiss' — the Linear side is Workstream
 * C's `createIssue()`, which has no HTTP route yet. Until it does, this fails,
 * and the page says why rather than implying the issue was created.
 */
export async function pushSuggestionToLinear(id: number): Promise<SuggestionActionResult> {
  try {
    return await postJson<SuggestionActionResult>('/suggestions', { id, action: 'push-to-linear' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/action/i.test(message)) {
      throw new Error(
        'Linear push is not wired up yet — /api/suggestions accepts approve and dismiss only.'
      );
    }
    throw err;
  }
}
