import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Single shared SQLite handle per process. The web app (geo-web) and the worker
 * (geo-worker) are separate processes hitting the same file — WAL mode is what
 * makes that safe, so never remove it.
 */

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  const rel = process.env.DATABASE_PATH ?? './data/geo.db';
  const file = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Wait rather than throw when the other process holds a write lock.
  db.pragma('busy_timeout = 5000');

  instance = db;
  return db;
}

/** Convenience wrappers so callers don't repeat prepare/all/get everywhere. */
export function all<T = unknown>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []) {
  return getDb().prepare(sql).run(...(params as never[]));
}

/** Parse a JSON column defensively — a malformed value must never crash a page. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
