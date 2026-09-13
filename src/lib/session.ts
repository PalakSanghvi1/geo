/**
 * Server-side session checks for route handlers.
 *
 * This is the real boundary. `src/proxy.ts` is an optimistic redirect for
 * humans; anything that reads or changes data verifies here, against the
 * database, on every request.
 *
 * Deliberately not wrapped in React `cache()`: that memoises per render pass,
 * which does nothing for route handlers — and every data route in this app is a
 * route handler.
 */
import { auth } from './auth';

/**
 * Whether sign-in is switched on for this deployment.
 *
 * Off by default, deliberately. Sign-in is finished but the server it would run
 * on is plain HTTP with no mail transport, where `sendMagicLink` throws on
 * purpose — so a deploy with the gate live would present a login page that
 * nobody on earth could get past, and take the dashboard with it.
 *
 * Set AUTH_ENABLED=true once the box has a domain, a certificate and a mail
 * transport. Until then the nginx basic auth is what protects it.
 */
export const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/** The signed-in user, or null. Never throws. */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    };
  } catch {
    return null;
  }
}

/** Thrown by requireSession; mapped to 401 by the API error handler. */
export class UnauthorizedError extends Error {
  constructor(message = 'Sign in to continue') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * The signed-in user, or throw.
 *
 * Returns null when sign-in is switched off, so callers keep their pre-auth
 * behaviour instead of rejecting every request on a deployment that has no way
 * to sign anyone in.
 */
export async function requireSession(request: Request): Promise<SessionUser | null> {
  if (!AUTH_ENABLED) return null;
  const user = await getSessionUser(request);
  if (!user) throw new UnauthorizedError();
  return user;
}
