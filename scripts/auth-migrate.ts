/**
 * Create or update better-auth's own tables (user, session, account,
 * verification) inside DATABASE_PATH.
 *
 *   npm run auth-migrate
 *
 * Separate from `npm run migrate`, which owns the product schema in
 * scripts/migrate.ts. better-auth derives its schema from the configured
 * plugins, so this must be re-run whenever a plugin is added — enabling the
 * organization plugin, for instance, adds its tables here rather than there.
 *
 * Idempotent: getMigrations diffs against the live database and returns
 * nothing to run when the schema already matches.
 */
import '../src/lib/env';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from '../src/lib/auth';

async function main() {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

  const created = toBeCreated.map((t) => t.table);
  const altered = toBeAdded.map((t) => t.table);

  if (created.length === 0 && altered.length === 0) {
    console.log('auth-migrate: ok — schema already matches, nothing to do');
    return;
  }

  if (created.length > 0) console.log(`auth-migrate: creating ${created.join(', ')}`);
  if (altered.length > 0) console.log(`auth-migrate: altering ${altered.join(', ')}`);

  await runMigrations();
  console.log('auth-migrate: ok');
}

main().catch((error: unknown) => {
  console.error(`auth-migrate failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
