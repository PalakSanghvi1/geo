/**
 * Timestamped console logging. pm2 captures stdout per process, so these lines
 * are the only debugging surface on the VPS — keep them terse and greppable.
 */
export function log(scope: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

export function logError(scope: string, message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}` : error === undefined ? '' : String(error);
  console.error(
    `[${new Date().toISOString()}] [${scope}] ERROR ${message}${detail ? ` — ${detail}` : ''}`
  );
}
