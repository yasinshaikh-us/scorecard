// The category color palette -- one stable color per category, so a
// category reads as the same color everywhere it's charted.
export const PALETTE = [
  "#3FA796", "#C1666B", "#E8B04B", "#7B8FA1", "#9B6B9E", "#5C9DAD", "#B98B5E", "#6E9F7E",
  "#A65D5D", "#8F7EBA", "#5E8B7E", "#C97D60", "#4E8FA8", "#B0567A", "#7EA85E", "#A87E4E",
  "#6E7EBA", "#C9A05E", "#8E6E9F", "#5E9B8E", "#B87E8E", "#7E9BA8", "#A8945E", "#8E7E5E",
];

// Stable per-category color, keyed by that category's index in the full
// (not just currently-filtered) category list -- so a category keeps the
// same color across different questions/charts, not just within one.
export function catColor(cat: string, CATS: string[], topCategory: (c: string) => string) {
  const i = CATS.indexOf(topCategory(cat));
  return PALETTE[((i < 0 ? 0 : i) % PALETTE.length + PALETTE.length) % PALETTE.length];
}
