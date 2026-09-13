/**
 * Background worker — Workstream C owns this file and will replace it wholesale.
 *
 * Phase 0 placeholder: it only proves the pm2 process boots and can reach the
 * database. The real worker (Phase C1) adds:
 *   - node-cron daily run + weekly Notion/Linear jobs
 *   - the run_requests poller (dashboard "Run now" + Slack `/geo run`)
 *   - the Slack Socket Mode bot
 */
import '../lib/env';
import { get } from '../lib/db';

function main() {
  const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM queries`);
  console.log(
    `[worker] up — db reachable, ${row?.n ?? 0} queries tracked. ` +
      `Placeholder until Workstream C lands; holding process open.`
  );

  // Keep the pm2 process alive without busy-waiting.
  setInterval(() => {}, 1 << 30);
}

main();
