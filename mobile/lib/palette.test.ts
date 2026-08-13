import { describe, it, expect } from "@jest/globals";
import { catColor, paletteFor } from "./palette";
import { topCategory } from "./logic";
import { CATEGORIES } from "./categories";
import { darkColors, lightColors, type ThemeMode } from "./theme";

// Relative luminance and contrast ratio, per WCAG 2.x. Duplicated here
// rather than imported because the app itself never needs to compute
// contrast at runtime -- only this test does, and a test that recomputes
// the value independently is what makes the assertion worth anything.
function luminance(hex: string) {
  const v = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("palette", () => {
  it("has the same number of colors in both themes, so an index means the same category in each", () => {
    expect(paletteFor("dark")).toHaveLength(paletteFor("light").length);
  });

  it("covers every category in the closed set without wrapping", () => {
    expect(paletteFor("light").length).toBeGreaterThanOrEqual(CATEGORIES.length);
  });

  it("gives a category the same index -- and so the same slot -- in both themes", () => {
    for (const cat of CATEGORIES) {
      const light = catColor(cat, CATEGORIES, topCategory, "light");
      const dark = catColor(cat, CATEGORIES, topCategory, "dark");
      expect(paletteFor("light").indexOf(light)).toBe(paletteFor("dark").indexOf(dark));
    }
  });

  it("defaults to the light palette when no mode is given", () => {
    expect(catColor("Groceries", CATEGORIES, topCategory)).toBe(catColor("Groceries", CATEGORIES, topCategory, "light"));
  });

  it("falls back to the first slot for a category not in the list", () => {
    expect(catColor("Not A Category", [], topCategory, "light")).toBe(paletteFor("light")[0]);
  });

  // The reason there are two palettes at all. A ~2px lucide stroke at
  // 15px is a far thinner mark than a solid chart bar, and every one of
  // these 24 failed this against at least one theme before the retone.
  //
  // The worst-case ground per theme is not the obvious one: in light the
  // mark is dark, so the *darker* ground (the cream page background, not
  // the white card) is the harder case; in dark the mark is light, so the
  // *lighter* ground (the Ask card's surface, not the page) is.
  const worstCaseGround: { mode: ThemeMode; ground: string }[] = [
    { mode: "light", ground: lightColors.bg },
    { mode: "dark", ground: darkColors.surface },
  ];

  it.each(worstCaseGround)("clears 4.5:1 for every category against $mode's worst-case ground", ({ mode, ground }) => {
    const failures = paletteFor(mode)
      .map((c) => ({ color: c, ratio: contrast(c, ground) }))
      .filter(({ ratio }) => ratio < 4.5);
    expect(failures).toEqual([]);
  });
});
