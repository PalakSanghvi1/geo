'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  mockAnswerDetail,
  mockOverview,
  mockPrompts,
  mockRuns,
  mockSources,
  mockSuggestions,
} from '@/lib/mock';
import type {
  AnswerDetailResponse,
  OverviewResponse,
  PromptRow,
  Run,
  SourceRow,
  Suggestion,
} from '@/lib/types';

/**
 * Mirrors `basePath` in next.config.ts. Browser fetches are not rewritten by
 * Next, so the base path has to be spelled out here — nginx only proxies /geo.
 */
export const API_BASE = '/geo/api';

/**
 * Workstream A's routes land at Checkpoint 2. Until then set
 * NEXT_PUBLIC_USE_MOCK=1 in .env.local to run the dashboard on src/lib/mock.ts.
 *
 * Opt-in rather than opt-out on purpose: the VPS .env does not set it, so a
 * production build always talks to the real API, and when mock mode IS on the
 * header carries a MOCK DATA badge. Invented numbers must never be able to
 * pass for measurements during judging.
 */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === '1';

export type ProviderParam = 'all' | 'anthropic' | 'openai' | 'gemini';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response for the current key. Polling stays quiet. */
  loading: boolean;
  refresh: () => void;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${API_BASE}${path}`);
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${API_BASE}${path}`);
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
  const loadRef = useRef(load);
  loadRef.current = load;

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
    USE_MOCK
      ? Promise.resolve(mockOverview(days, provider))
      : getJson<OverviewResponse>(`/overview?days=${days}&provider=${provider}`)
  );
}

export function useRuns(pollMs = 0): AsyncState<Run[]> {
  return useResource(
    'runs',
    () => (USE_MOCK ? Promise.resolve(mockRuns()) : getJson<Run[]>('/runs')),
    pollMs
  );
}

export function usePrompts(): AsyncState<PromptRow[]> {
  return useResource('prompts', () =>
    USE_MOCK ? Promise.resolve(mockPrompts()) : getJson<PromptRow[]>('/prompts')
  );
}

export function useAnswerDetail(answerId: number): AsyncState<AnswerDetailResponse> {
  return useResource(`answer:${answerId}`, () =>
    USE_MOCK
      ? Promise.resolve(mockAnswerDetail(answerId))
      : getJson<AnswerDetailResponse>(`/answers/${answerId}`)
  );
}

/**
 * Queues a run. Everything that starts work — cron, Slack, this button — goes
 * through `run_requests`, so the worker has one code path to poll.
 */
export async function triggerRun(note: string): Promise<void> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return;
  }
  await postJson('/trigger', { note });
}

export function useSources(days: number, provider: ProviderParam): AsyncState<SourceRow[]> {
  return useResource(`sources:${days}:${provider}`, () =>
    USE_MOCK
      ? Promise.resolve(mockSources(days, provider))
      : getJson<SourceRow[]>(`/sources?days=${days}&provider=${provider}`)
  );
}

/** Pending suggestions only — the API does not return resolved ones. */
export function useSuggestions(): AsyncState<Suggestion[]> {
  return useResource('suggestions', () =>
    USE_MOCK ? Promise.resolve(mockSuggestions()) : getJson<Suggestion[]>('/suggestions')
  );
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
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const suggestion = mockSuggestions().find((s) => s.id === id);
    if (!suggestion) throw new Error(`No suggestion with id ${id}`);
    return {
      suggestion: { ...suggestion, status: action === 'approve' ? 'approved' : 'dismissed' },
      created:
        action === 'approve'
          ? { table: suggestion.kind === 'competitor' ? 'brands' : 'queries', id: 99, duplicate: false }
          : { table: null, id: null, duplicate: false },
    };
  }
  return postJson<SuggestionActionResult>('/suggestions', { id, action });
}

/**
 * BUILD_PLAN section 7 puts push-to-linear on this endpoint, but the route Dev A
 * shipped accepts only 'approve' | 'dismiss' — the Linear side is Workstream C's
 * `createIssue()`, which has no HTTP route yet. Calling this today returns a 400
 * that the page surfaces verbatim rather than pretending the push succeeded.
 */
export async function pushSuggestionToLinear(id: number): Promise<SuggestionActionResult> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const suggestion = mockSuggestions().find((s) => s.id === id);
    if (!suggestion) throw new Error(`No suggestion with id ${id}`);
    return { suggestion: { ...suggestion, linear_issue_id: `GEO-${11 + id}` } };
  }
  return postJson<SuggestionActionResult>('/suggestions', { id, action: 'push-to-linear' });
}
