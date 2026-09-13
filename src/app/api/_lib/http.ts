/**
 * Shared helpers for the dashboard read/write API routes.
 *
 * Lives in a private folder (`_lib`) so the App Router does not try to treat it
 * as a route segment. Only `route.ts` files under `src/app/api/` are routes.
 *
 * Two rules every handler in this directory follows:
 *   1. Query params are untrusted — parse and bound them here, never interpolate
 *      them into SQL (the db helpers take bound parameters).
 *   2. Nothing throws out of a handler. Bad input is a 400, a missing row is a
 *      404, anything unexpected is a 500 with a JSON `{ error }` body. The
 *      database may legitimately be empty (the build runs before seeding), so
 *      "no rows" is always an empty array / null, never an error.
 */
import { NextResponse } from 'next/server';
import { UnauthorizedError } from '@/lib/session';
import type { ProviderId } from '@/lib/types';

export type ProviderFilter = ProviderId | 'all';

const PROVIDERS: readonly ProviderFilter[] = ['anthropic', 'openai', 'gemini', 'all'];

export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 14;

/** Thrown by the parsers below; turned into a 400 by `fail()`. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Thrown when an addressed row does not exist; turned into a 404 by `fail()`. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when the request is valid but conflicts with current state (409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * These endpoints read a live SQLite file that the worker writes to; a cached
 * response is always a wrong response (the Runs page polls this every 5s).
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function errorResponse(message: string, status: number): NextResponse<{ error: string }> {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/** Single catch-all translation from a thrown value to a JSON error response. */
export function fail(err: unknown): NextResponse<{ error: string }> {
  if (err instanceof UnauthorizedError) return errorResponse(err.message, 401);
  if (err instanceof BadRequestError) return errorResponse(err.message, 400);
  if (err instanceof NotFoundError) return errorResponse(err.message, 404);
  if (err instanceof ConflictError) return errorResponse(err.message, 409);
  console.error('[api] unhandled error:', err);
  return errorResponse('Internal server error', 500);
}

/* ------------------------------------------------------------------ */
/* Input parsing                                                       */
/* ------------------------------------------------------------------ */

/** `?days=` — integer, 1..90, defaults to 14. */
export function parseDays(searchParams: URLSearchParams, fallback = DEFAULT_DAYS): number {
  const raw = searchParams.get('days');
  if (raw === null || raw === '') return fallback;
  if (!/^\d{1,3}$/.test(raw)) {
    throw new BadRequestError(`Invalid 'days': must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
    throw new BadRequestError(`Invalid 'days': must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`);
  }
  return n;
}

/** `?provider=` — one of the three providers or 'all' (default). */
export function parseProvider(searchParams: URLSearchParams): ProviderFilter {
  const raw = searchParams.get('provider');
  if (raw === null || raw === '') return 'all';
  if (!PROVIDERS.includes(raw as ProviderFilter)) {
    throw new BadRequestError(`Invalid 'provider': must be one of ${PROVIDERS.join(', ')}`);
  }
  return raw as ProviderFilter;
}

/** A positive integer row id from a path segment or JSON body. */
export function parseId(raw: unknown, field = 'id'): number {
  const value = typeof raw === 'number' ? String(raw) : raw;
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) {
    throw new BadRequestError(`Invalid '${field}': must be a positive integer`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new BadRequestError(`Invalid '${field}': must be a positive integer`);
  }
  return n;
}

/** Reads a JSON body, tolerating an empty or malformed one as `{}`. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Narrows a DB `provider` column to the union type, ignoring anything unknown. */
export function asProviderId(raw: unknown): ProviderId | null {
  return raw === 'anthropic' || raw === 'openai' || raw === 'gemini' ? raw : null;
}
