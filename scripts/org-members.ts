/**
 * Create an organization and attach people to it, by email.
 *
 *   npm run org-members -- --org "Lemma AI" someone@example.com another@example.com
 *   npm run org-members -- --org "Lemma AI" --role owner boss@example.com
 *   npm run org-members -- --list
 *
 * Addresses are arguments, never committed: this is a public repo and the
 * membership list is personal data.
 *
 * Someone who has never signed in gets a user row here with `emailVerified = 0`.
 * better-auth matches magic-link sign-in on email, so when they do sign in they
 * land on this row and keep the membership rather than getting a second account.
 *
 * Idempotent: re-running adds nobody twice and never downgrades an existing role.
 *
 * Membership is recorded, NOT yet enforced — no product query filters by
 * organization. See docs/multi-tenant-plan.md section 3.2.
 */
import '../src/lib/env';
import { randomUUID } from 'node:crypto';
import { all, get, run } from '../src/lib/db';

type Role = 'owner' | 'admin' | 'member';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/\d+$/, ''))
    .join(' ');
}

function listMembers(): void {
  const orgs = all<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM organization ORDER BY name`
  );
  if (orgs.length === 0) {
    console.log('No organizations yet.');
    return;
  }
  for (const org of orgs) {
    console.log(`\n${org.name}  (${org.slug})`);
    const members = all<{ email: string; role: string; emailVerified: number }>(
      `SELECT u.email, m.role, u.emailVerified
         FROM member m JOIN user u ON u.id = m.userId
        WHERE m.organizationId = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
      [org.id]
    );
    if (members.length === 0) console.log('  (no members)');
    for (const m of members) {
      console.log(`  ${m.role.padEnd(6)}  ${m.email}${m.emailVerified ? '' : '   (never signed in)'}`);
    }
  }
}

function findOrCreateOrg(name: string): { id: string; created: boolean } {
  const slug = slugify(name);
  const existing = get<{ id: string }>(
    `SELECT id FROM organization WHERE slug = ? OR lower(name) = lower(?)`,
    [slug, name]
  );
  if (existing) return { id: existing.id, created: false };

  const id = randomUUID();
  run(
    `INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, datetime('now'))`,
    [id, name, slug]
  );
  return { id, created: true };
}

function findOrCreateUser(email: string): { id: string; created: boolean } {
  const existing = get<{ id: string }>(`SELECT id FROM user WHERE lower(email) = lower(?)`, [email]);
  if (existing) return { id: existing.id, created: false };

  const id = randomUUID();
  run(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))`,
    [id, nameFromEmail(email), email]
  );
  return { id, created: true };
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) return listMembers();

  const orgIndex = argv.indexOf('--org');
  const roleIndex = argv.indexOf('--role');
  const orgName = orgIndex === -1 ? null : argv[orgIndex + 1];
  const role = (roleIndex === -1 ? 'member' : argv[roleIndex + 1]) as Role;

  if (!orgName) {
    console.error('org-members: --org "<name>" is required. Use --list to see what exists.');
    process.exit(1);
  }
  if (!['owner', 'admin', 'member'].includes(role)) {
    console.error(`org-members: unknown role "${role}" — expected owner, admin or member.`);
    process.exit(1);
  }

  const skip = new Set<number>([orgIndex, orgIndex + 1, roleIndex, roleIndex + 1]);
  const emails = argv.filter((a, i) => !skip.has(i) && a.includes('@'));
  if (emails.length === 0) {
    console.error('org-members: give at least one email address.');
    process.exit(1);
  }

  const org = findOrCreateOrg(orgName);
  console.log(`org-members: ${org.created ? 'created' : 'found'} organization "${orgName}"`);

  for (const email of emails) {
    const user = findOrCreateUser(email);
    const existing = get<{ role: string }>(
      `SELECT role FROM member WHERE organizationId = ? AND userId = ?`,
      [org.id, user.id]
    );
    if (existing) {
      console.log(`  unchanged  ${email}  (already ${existing.role})`);
      continue;
    }
    run(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [randomUUID(), org.id, user.id, role]
    );
    console.log(`  added      ${email}  as ${role}${user.created ? '  (new user, never signed in)' : ''}`);
  }

  console.log('\norg-members: done. Membership is recorded but not yet enforced by any query.');
}

main();
