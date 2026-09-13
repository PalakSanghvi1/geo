/**
 * Idempotent schema migration. Safe to run on every deploy.
 *   npm run migrate
 *
 * This schema is a frozen contract across all three workstreams (see BUILD_PLAN
 * section 3). Changes after Phase 0 go through Dev A only.
 */
import '../src/lib/env';
import { getDb } from '../src/lib/db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0,
  aliases TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  parent_id INTEGER REFERENCES queries(id),
  tag TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  run_date TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  total_calls INTEGER NOT NULL DEFAULT 0,
  ok_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  query_id INTEGER NOT NULL REFERENCES queries(id),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer_text TEXT,
  citations TEXT NOT NULL DEFAULT '[]',
  other_brands TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  answer_id INTEGER NOT NULL REFERENCES answers(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  position INTEGER NOT NULL,
  sentiment INTEGER NOT NULL DEFAULT 0,
  quote TEXT
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'linear',
  status TEXT NOT NULL DEFAULT 'pending',
  linear_issue_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_requests (
  id INTEGER PRIMARY KEY,
  requested_by TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  run_id INTEGER REFERENCES runs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answers_run ON answers(run_id);
CREATE INDEX IF NOT EXISTS idx_answers_query ON answers(query_id);
CREATE INDEX IF NOT EXISTS idx_mentions_answer ON mentions(answer_id);
CREATE INDEX IF NOT EXISTS idx_mentions_brand ON mentions(brand_id);
CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(run_date);
CREATE INDEX IF NOT EXISTS idx_run_requests_status ON run_requests(status);
`;

function main() {
  const db = getDb();
  db.exec(SCHEMA);

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>;

  console.log(`migrate: ok — ${tables.length} tables [${tables.map((t) => t.name).join(', ')}]`);
}

main();
