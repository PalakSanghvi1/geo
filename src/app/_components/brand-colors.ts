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
/** Must track --color-hairline in globals.css; Recharts needs a literal. */
export const HAIRLINE = 'rgba(11,11,11,0.08)';

/**
 * How many brands get a hue of their own.
 *
 * Five, and not more, because the count is measured rather than chosen: a
 * ten-hue categorical palette fails the colour checks outright (a brown and a
 * red land 1.8 ΔE apart under protanopia and 14.6 to full colour vision, below
 * the readable floor), and eight is worse still. Categorical hues are assigned
 * in fixed order and never generated to fill a longer list.
 *
 * Brands past this point still appear on the chart — see `chartBrands` — drawn
 * in the muted grey and identified by the label at the end of their line, so
 * identity never rests on a colour nobody can name.
 */
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

  // Wrapping the palette would give the 1st and 5th competitor the same colour.
  others.forEach((row, i) => {
    colors.set(row.brand, SERIES_COLORS[i + 1] ?? SERIES_MUTED);
  });

  return colors;
}

/**
 * The brands that earn a line on the chart: the self brand plus the top competitors.
 *
 * Colours are assigned over the WHOLE scoreboard and only then filtered by
 * `drawable`. Assigning over the filtered list instead would shift every
 * subsequent competitor one slot along, so the dot beside a brand in the table
 * would not match its line in the chart — the exact drift this module exists
 * to prevent.
 */
export function chartBrands(
  scoreboard: BrandLike[],
  drawable: (brand: string) => boolean = () => true
): Array<BrandLike & { color: string; keyed: boolean }> {
  const colors = assignBrandColors(scoreboard);
  const present = scoreboard.filter((row) => drawable(row.brand));
  const self = present.find((row) => row.isSelf);
  const others = present.filter((row) => !row.isSelf);
  const chosen = self ? [self, ...others] : others;

  return chosen.map((row) => {
    const color = colors.get(row.brand) ?? SERIES_MUTED;
    // `keyed` marks the brands with a hue of their own, so the legend can show
    // which identities colour actually carries.
    return { ...row, color, keyed: color !== SERIES_MUTED };
  });
}
