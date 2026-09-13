'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './sidebar';
import { Logo } from './logo';
import { cx } from './ui';

/**
 * Navigation for phones, where the 212px sidebar would eat more than half the
 * screen.
 *
 * A horizontal strip rather than a hamburger: there are five destinations, they
 * fit, and a menu that has to be opened hides the fact that the other pages
 * exist. The strip scrolls sideways on the narrowest screens instead of
 * wrapping, so the header keeps one predictable height.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 backdrop-blur md:hidden">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Logo size={16} />
        <span className="font-mono text-[12px] font-semibold tracking-[0.18em]">GEO</span>
      </div>

      <nav
        aria-label="Dashboard sections"
        className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'shrink-0 rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors',
                active ? 'bg-card text-ink shadow-[0_0_0_1px_rgba(11,11,11,0.08)]' : 'text-ink-muted'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
