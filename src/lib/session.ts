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

/** The signed-in user, or throw. */
export async function requireSession(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw new UnauthorizedError();
  return user;
}
