/**
 * Notion integration — weekly visibility report published as a child page of
 * NOTION_PARENT_PAGE_ID.
 *
 * Phase C1: signatures + the weekly cron wiring only. Phase C3 builds the
 * blocks (callout, QuickChart image, scoreboard table, sources, takeaways).
 */
import { log } from '../worker/log';

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_PARENT_PAGE_ID);
}

/**
 * Publish the report for the week ending `weekEndingDate` (YYYY-MM-DD).
 * Returns the new page URL. TODO(C3): build and create the page.
 */
export async function publishWeeklyReport(weekEndingDate: string): Promise<string | null> {
  if (!isNotionConfigured()) {
    log('notion', 'NOTION_TOKEN / NOTION_PARENT_PAGE_ID not set — publish skipped');
    return null;
  }
  log('notion', `weekly report not implemented yet (Phase C3) — week ending ${weekEndingDate}`);
  return null;
}
