/**
 * Authentication server.
 *
 * Email magic link only — no passwords to store, reset or leak. Sessions live in
 * the same SQLite file as everything else (`DATABASE_PATH`), so the worker can
 * resolve who requested a run without a network call to an identity provider.
 *
 * Local development note: there is no mail transport wired up yet, so the magic
 * link is written to the server console. That is deliberate for local work and
 * MUST NOT reach a deployment — see `sendMagicLink` below, which refuses to run
 * outside development.
 *
 * Not yet done, tracked in docs/multi-tenant-plan.md: organizations, and the
 * per-organization data filtering that makes sign-in meaningful. This lands
 * sign-in itself.
 */
import './env';
import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { nextCookies } from 'better-auth/next-js';

/**
 * Its own handle rather than `getDb()`.
 *
 * better-auth drives the connection through Kysely and runs its own migrations
 * against it; sharing the singleton would put two different owners on one
 * handle. Same file, so WAL still serialises writes correctly.
 */
function authDatabase(): Database.Database {
  const rel = process.env.DATABASE_PATH ?? './data/geo.db';
  const file = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Where the app itself lives, base path included. Magic links and post-sign-in
 * redirects are built from this, so it must be a URL a browser can reach — not
 * localhost, once this is deployed.
 */
export const APP_BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ?? 'http://localhost:3100/geo';

/**
 * Where the auth endpoints are mounted.
 *
 * Note this is the FULL path, not an origin plus a separate `basePath` option.
 * When `baseURL` carries a path, better-auth treats that path as the mount
 * point and ignores `basePath` entirely — so an origin of `.../geo` with
 * `basePath: '/api/auth'` silently mounts the endpoints at `/geo/sign-in/...`,
 * colliding with the app's own routes. Verified against 1.7.4 by probing the
 * handler directly; both halves have to go in `baseURL`.
 */
export const AUTH_BASE_URL = `${APP_BASE_URL}/api/auth`;

export const auth = betterAuth({
  database: authDatabase(),
  baseURL: AUTH_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      sendMagicLink: async ({ email, url }) => {
        if (isProduction) {
          // Failing loudly beats silently logging a working sign-in token into
          // pm2's logs, where anyone with shell access could replay it.
          throw new Error(
            'No mail transport is configured. Wire one up before running auth in production.'
          );
        }
        console.log(
          `\n  Magic link for ${email}\n  ${url}\n  (development only — this is printed because no mail transport is configured)\n`
        );
      },
    }),
    /**
     * Organizations are the tenant boundary. Enabling the plugin creates the
     * organization / member / invitation tables, but it does NOT by itself
     * scope any of the product's own queries — see docs/multi-tenant-plan.md
     * section 3.2. Until that lands, membership is recorded but not enforced.
     */
    organization(),
    // Must stay last: it copies better-auth's Set-Cookie headers onto the
    // Next.js response.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
