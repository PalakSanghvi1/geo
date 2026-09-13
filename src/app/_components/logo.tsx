/**
 * The GEO mark: three rising bars.
 *
 * Drawn once and used in the sidebar, on the sign-in page, and — as
 * src/app/icon.svg, the same geometry on an ink background — in the browser tab.
 *
 * It was a ring with a partial arc, which is the exact shape of every loading
 * spinner on the web and read as one. Bars cannot be mistaken for progress.
 */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="GEO"
      className="shrink-0"
    >
      <rect x="7" y="18" width="4.5" height="7" rx="1.2" fill="var(--color-accent)" />
      <rect x="13.75" y="13" width="4.5" height="12" rx="1.2" fill="var(--color-accent)" />
      <rect x="20.5" y="7" width="4.5" height="18" rx="1.2" fill="var(--color-accent)" />
    </svg>
  );
}
