/**
 * Every better-auth endpoint: sign-in, magic-link verification, session, sign-out.
 * Served at /geo/api/auth/*.
 *
 * Why the rebasing below exists.
 *
 * better-auth matches incoming requests against `baseURL` + `basePath`, and it
 * builds the links it emails from the same pair. Next, meanwhile, strips the
 * `/geo` base path before a route handler ever sees the request. Those two facts
 * conflict:
 *
 *   - `baseURL` without `/geo`: requests match, but the magic link points at
 *     http://host/api/auth/... which 404s in the browser. Verified.
 *   - `baseURL` with `/geo`: the link is right, but every request 404s, because
 *     better-auth is looking for /geo/api/auth/... and Next handed it
 *     /api/auth/... Also verified.
 *
 * So `baseURL` keeps the base path — the emailed link has to be real — and the
 * prefix is put back on the request here, before better-auth routes it.
 */
import { toNextJsHandler } from 'better-auth/next-js';
import { auth, APP_BASE_URL } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The path segment Next strips, derived from the configured public URL. */
const BASE_PATH = new URL(APP_BASE_URL).pathname.replace(/\/$/, '');

async function rebase(request: Request): Promise<Request> {
  if (!BASE_PATH || BASE_PATH === '/') return request;

  const url = new URL(request.url);
  if (url.pathname.startsWith(`${BASE_PATH}/`)) return request;
  url.pathname = `${BASE_PATH}${url.pathname}`;

  // Rebuilt rather than `new Request(url, request)`: passing a streaming body
  // through the two-argument form requires `duplex`, and auth payloads are
  // small enough that buffering costs nothing.
  const init: RequestInit = { method: request.method, headers: request.headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  return new Request(url, init);
}

const handlers = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  return handlers.GET(await rebase(request));
}

export async function POST(request: Request): Promise<Response> {
  return handlers.POST(await rebase(request));
}
