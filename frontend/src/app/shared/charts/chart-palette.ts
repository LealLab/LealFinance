import { Theme } from '../../core/theme.service';

/**
 * Resolves a CSS custom property (design token) to its current computed
 * value. Chart.js draws into a `<canvas>` via the 2D context, which does
 * *not* resolve `var(--x)` the way a real CSS property would - passing a
 * raw `var(...)` string as a dataset color silently fails - so semantic
 * tokens (accent, positive, negative) need this instead of a literal
 * `var(--x)` string wherever they're used as a chart color.
 */
export function resolveCssColor(name: string, fallback = '#000000'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * The dataviz skill's validated reference categorical palette, used
 * unchanged (not re-derived for this brand) - 8 hues, fixed order, that
 * clear every adjacent-pair CVD/contrast gate in both light and dark
 * mode. Order is the CVD-safety mechanism, not cosmetic: never reorder or
 * cycle these per-chart.
 */
const CATEGORICAL_LIGHT: readonly string[] = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948'
];

const CATEGORICAL_DARK: readonly string[] = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
];

/**
 * Builds a *stable* categoryId → color map from a fixed-order list of ids
 * (categories as fetched, not as sorted by this month's spend) - so a
 * category keeps the same color every time it's rendered regardless of
 * its current rank. Re-coloring survivors when a filter changes their
 * order is exactly what the palette's ordering rule exists to prevent.
 * Past the 8-slot ceiling, ids fold onto slot 8 (the palette's own "past
 * the token ceiling, fold the tail" guidance) rather than generating a
 * 9th hue, which would be indistinguishable from an existing one under CVD.
 *
 * "As fetched" now means "in the user's chosen `Category.position` order"
 * - the Categories screen supports manual drag/keyboard reordering (see
 * features/categories/categories.ts), so a category's color can change
 * when the user reorders its siblings. That's intended: the user picked
 * the new order, so a new color assignment following it is a consequence
 * of *their* choice, not the instability this function's ordering
 * contract was written to prevent (which is about *unrelated* state -
 * e.g. this month's spend changing - silently reshuffling colors).
 */
export function categoryColorMap(orderedIds: readonly string[], theme: Theme): Map<string, string> {
  const palette = theme === 'dark' ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  const map = new Map<string, string>();
  orderedIds.forEach((id, index) => {
    map.set(id, palette[Math.min(index, palette.length - 1)]);
  });
  return map;
}
