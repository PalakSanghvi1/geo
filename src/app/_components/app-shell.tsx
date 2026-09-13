'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

/**
 * The dashboard chrome, minus the routes that must not show it.
 *
 * Sign-in is a full-page route: a signed-out visitor should not be looking at
 * navigation for pages they cannot open, or at a project name they may have no
 * access to.
 *
 * A layout cannot remove its parent's chrome, so this checks the path instead.
 * The tidier fix is route groups — dashboard pages under one layout, auth pages
 * under another — but that moves every page file, which belongs in its own
 * change rather than riding along with authentication.
 */
const BARE_ROUTES = ['/login'];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (bare) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
