'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PROJECT } from '@/lib/config';
import { Logo } from './logo';
import { cx, FieldLabel } from './ui';
import { authClient, useSession } from '@/lib/auth-client';

/* Inline 16px line icons — no icon dependency for five glyphs. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden {...stroke}>
      {children}
    </svg>
  );
}

const NAV = [
  {
    href: '/',
    label: 'Overview',
    icon: <Icon><path d="M1.5 11.5 5 7l3 2.5L14.5 3" /></Icon>,
  },
  {
    href: '/prompts',
    label: 'Prompts',
    icon: <Icon><path d="M2 3.5h12v7H6.5L3 13.5v-3H2z" /></Icon>,
  },
  {
    href: '/sources',
    label: 'Sources',
    icon: (
      <Icon>
        <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7" />
        <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />
      </Icon>
    ),
  },
  {
    href: '/runs',
    label: 'Runs',
    icon: <Icon><path d="M1.5 9.5 4 9.5 5.5 5l2.5 7 2-4.5 1.5 2h3" /></Icon>,
  },
  {
    href: '/suggestions',
    label: 'Suggestions',
    icon: (
      <Icon>
        <circle cx="4" cy="4" r="1.75" />
        <circle cx="4" cy="12" r="1.75" />
        <circle cx="12" cy="8" r="1.75" />
        <path d="M5.75 4h2.5a2 2 0 0 1 2 2v.5M5.75 12h2.5a2 2 0 0 0 2-2v-.5" />
      </Icon>
    ),
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[212px] shrink-0 flex-col border-r border-hairline">
      <div className="flex items-center gap-2 px-5 py-5">
        <Logo size={18} />
        <span className="font-mono text-[13px] font-semibold tracking-[0.18em]">GEO</span>
      </div>

      <nav aria-label="Dashboard sections" className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          // Every other route is a prefix of nothing, so only "/" needs exact matching.
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'border border-hairline bg-card font-medium text-ink'
                  : 'border border-transparent text-ink-muted hover:text-ink'
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-hairline px-5 py-4">
        <FieldLabel>Project</FieldLabel>
        <p className="mt-1 text-sm font-medium">{PROJECT.name}</p>
        <p className="text-xs text-ink-muted">{PROJECT.domain}</p>
        <AccountFooter />
      </div>
    </aside>
  );
}

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing until the session resolves, rather than flashing a signed-out
 * state at someone who is signed in.
 */
function AccountFooter() {
  const { data, isPending } = useSession();
  if (isPending || !data?.user) return null;

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="truncate text-xs text-ink-muted" title={data.user.email}>
        {data.user.email}
      </p>
      <button
        type="button"
        className="mt-1 text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
        onClick={() =>
          authClient.signOut({
            fetchOptions: { onSuccess: () => window.location.assign('/geo/login') },
          })
        }
      >
        Sign out
      </button>
    </div>
  );
}
