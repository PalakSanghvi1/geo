'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mockOverview, mockRuns } from '@/lib/mock';
import type { OverviewResponse, Run } from '@/lib/types';

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
