/**
 * One brand → one colour, shared by the chart and the scoreboard. If these two
 * ever disagree the dashboard silently lies about which line is which, so both
 * read their colours from here.
 *
 * Literal hex rather than the CSS variables in globals.css: these values get
 * handed to Recharts, which writes them into SVG attributes, and Tailwind can
 * drop theme variables it sees no utility for.
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
export const SERIES_MUTED = '#b8b7b0';

export const INK = '#0b0b0b';
export const INK_MUTED = '#6b6a65';
export const INK_FAINT = '#9d9c95';
export const HAIRLINE = 'rgba(11,11,11,0.10)';

/** Brands beyond this many get the muted dot and stay off the chart. */
export const MAX_SERIES = 5;

export interface BrandLike {
  brand: string;
  isSelf: boolean;
}

/**
 * The self brand always keeps the blue accent and the first slot; the rest of
 * the palette goes to the highest-visibility competitors, in scoreboard order.
 * Everything past MAX_SERIES is muted.
 *
 * `scoreboard` must already be sorted by visibility, as the API returns it.
 */
export function assignBrandColors(scoreboard: BrandLike[]): Map<string, string> {
  const self = scoreboard.find((row) => row.isSelf);
  const others = scoreboard.filter((row) => !row.isSelf);

  const colors = new Map<string, string>();
  if (self) colors.set(self.brand, SERIES_COLORS[0]);

  const slots = self ? MAX_SERIES - 1 : MAX_SERIES;
  others.forEach((row, i) => {
    colors.set(row.brand, i < slots ? SERIES_COLORS[(i % (SERIES_COLORS.length - 1)) + 1] : SERIES_MUTED);
  });

  return colors;
}

/** The brands that earn a line on the chart: the self brand plus the top competitors. */
export function chartBrands(scoreboard: BrandLike[]): Array<BrandLike & { color: string }> {
  const colors = assignBrandColors(scoreboard);
  const self = scoreboard.find((row) => row.isSelf);
  const others = scoreboard.filter((row) => !row.isSelf).slice(0, self ? MAX_SERIES - 1 : MAX_SERIES);
  const chosen = self ? [self, ...others] : others;
  return chosen.map((row) => ({ ...row, color: colors.get(row.brand) ?? SERIES_MUTED }));
}
