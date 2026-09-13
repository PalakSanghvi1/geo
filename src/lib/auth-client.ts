/**
 * Browser-side auth client.
 *
 * The base URL carries the `/geo` base path because browser fetches are not
 * rewritten by Next — the same reason `src/app/_lib/fetcher.ts` hardcodes its
 * API base.
 */
'use client';

import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  basePath: '/geo/api/auth',
  plugins: [magicLinkClient()],
});

export const { useSession, signOut } = authClient;
