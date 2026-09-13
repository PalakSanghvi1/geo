/**
 * Optimistic sign-in gate.
 *
 * This only checks that a session cookie is PRESENT — it does not validate it.
 * Next's own guidance is explicit that proxy "should not be used as a full
 * session management or authorization solution" and that the real checks belong
 * next to the data. So this exists purely to bounce signed-out visitors to the
 * login page instead of showing them an empty dashboard; anything that returns
 * or changes data must verify the session itself (see requireSession in
 * src/lib/session.ts).
 *
 * Note this file is `proxy.ts`, not `middleware.ts`: Next 16 renamed the
 * convention, and the exported function is `proxy`, not `middleware`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { AUTH_ENABLED } from '@/lib/session';

/** Paths a signed-out visitor may reach. Everything else redirects to login. */
const PUBLIC_PREFIXES = ['/login', '/api/auth'];

export function proxy(request: NextRequest) {
  // Nothing is gated until sign-in is switched on for this deployment.
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (getSessionCookie(request)) return NextResponse.next();

  // An API caller wants a status code, not a login page. Redirecting here would
  // turn "you are signed out" into a 307 followed by an HTML body, which every
  // fetch in the dashboard would then fail to parse as JSON.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in to continue' }, { status: 401 });
  }

  // basePath is NOT applied to a hand-built URL, so /geo goes in explicitly.
  const login = new URL('/geo/login', request.url);
  const target = pathname + request.nextUrl.search;
  if (target && target !== '/') login.searchParams.set('next', target);
  return NextResponse.redirect(login);
}

export const config = {
  // '/' is listed separately: the catch-all pattern below does not match the
  // index route on its own, so without this the dashboard itself stays open.
  // Verified — /geo returned 200 while /geo/runs correctly redirected.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
