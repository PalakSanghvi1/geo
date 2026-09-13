/**
 * Linear integration — reads the roadmap and turns it into tracking suggestions.
 *
 * Phase C1: signatures + the weekly cron wiring only. Phase C2 fills in the
 * GraphQL project fetch, the Sonnet suggestion call, and issue creation.
 */
import type { Suggestion } from '../lib/types';
import { log } from '../worker/log';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';

export function isLinearConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_KEY);
}

/**
 * Scan the roadmap and insert suggestions. Returns how many new rows landed.
 * TODO(C2): fetch projects, one Sonnet call, dedupe by text, insert.
 */
export async function runLinearScan(): Promise<number> {
  if (!isLinearConfigured()) {
    log('linear', 'LINEAR_API_KEY not set — scan skipped');
    return 0;
  }
  log('linear', 'scan not implemented yet (Phase C2) — no suggestions inserted');
  return 0;
}

/**
 * Push an approved suggestion into Linear as an issue, returning its id.
 * TODO(C2): issueCreate mutation titled "GEO: <text>" with the rationale in the body.
 */
export async function createIssue(suggestion: Suggestion): Promise<string | null> {
  if (!isLinearConfigured()) {
    log('linear', 'LINEAR_API_KEY not set — issue not created');
    return null;
  }
  log('linear', `createIssue not implemented yet (Phase C2) — suggestion #${suggestion.id}`);
  return null;
}
