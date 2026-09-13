/**
 * Re-export so app components keep a short import path while the implementation
 * lives with the other wording helpers in `src/lib/labels.ts` — the worker, the
 * Slack digest and the Notion report need it too, and `src/lib` cannot import from
 * `src/app`.
 */
export { formatRunDay } from '@/lib/labels';
