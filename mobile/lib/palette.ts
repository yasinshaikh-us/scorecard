import type { ThemeMode } from "./theme";

// The category color palette -- one stable color per category, so a
// category reads as the same color everywhere it's charted.
//
// There are two tonal variants of the same 24 hues rather than one
// shared list. The original single palette was drawn for solid chart
// fills, where a mid-tone reads fine on either ground; once the same
// color also had to carry a ~2px lucide stroke at 15px (the icon-only
// category marker on every transaction row), every one of the 24 failed
// 4.5:1 against at least one theme's worst-case ground.
//
// The worst-case ground per theme is not the obvious one:
//   light -- the mark is DARK, so the DARKER ground is the harder case.
//            That is Home's bg #F7F4EC, not the white card.
//   dark  -- the mark is LIGHT, so the LIGHTER ground is the harder case.
//            That is the Ask card's surface #1E242C, not Home's #14181D.
//
// Each variant was derived by walking lightness (and nudging saturation
// to replace the chroma darkening drains) until it cleared 4.5:1 against
// its own worst-case ground. Hue is never touched, so a category is
// recognizably the same color in both themes.
//
// 4.5:1 rather than WCAG 1.4.11's 3:1 for graphical objects: that 3:1
// assumes a solid shape, and a thin stroke needs the headroom.
const PALETTE_LIGHT = [
  "#2A7C6F", "#BA4C52", "#996506", "#5C7285", "#905F93", "#3F7785", "#93663A", "#4D795B",
  "#A45A5A", "#7963AE", "#50786C", "#AF5735", "#3E778C", "#AE5176", "#56783C", "#8E693F",
  "#596CB3", "#906827", "#846296", "#46786E", "#A6576D", "#547483", "#7E6E40", "#7C6E51",
];

const PALETTE_DARK = [
  "#3FA796", "#C77276", "#E8B04B", "#7B8FA1", "#A77BAA", "#5C9DAD", "#B98B5E", "#6E9F7E",
  "#B87979", "#9281BC", "#649586", "#C97D60", "#5094AE", "#C17392", "#7EA85E", "#AE8250",
  "#7988C1", "#C9A05E", "#9D80AC", "#5E9B8E", "#B87E8E", "#7E9BA8", "#A8945E", "#998865",
];

export function paletteFor(mode: ThemeMode) {
  return mode === "dark" ? PALETTE_DARK : PALETTE_LIGHT;
}

// Stable per-category color, keyed by that category's index in the full
// (not just currently-filtered) category list -- so a category keeps the
// same color across different questions/charts, not just within one.
// Both variants are the same length and in the same order, so the index a
// category resolves to is theme-independent; only the tone changes.
export function catColor(cat: string, CATS: string[], topCategory: (c: string) => string, mode: ThemeMode = "light") {
  const palette = paletteFor(mode);
  const i = CATS.indexOf(topCategory(cat));
  return palette[((i < 0 ? 0 : i) % palette.length + palette.length) % palette.length];
}
