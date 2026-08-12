import { describe, it, expect } from "@jest/globals";
import { HelpCircle, Wallet, UtensilsCrossed } from "lucide-react-native";
import { CATEGORY_ICONS, iconForCategory } from "./categoryIcons";
import { CATEGORIES } from "./categories";

describe("categoryIcons", () => {
  it("maps every category in the closed set to an icon", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_ICONS[category]).toBeDefined();
    }
  });

  it("iconForCategory returns the mapped icon for a known category", () => {
    expect(iconForCategory("Income")).toBe(Wallet);
    expect(iconForCategory("Dining")).toBe(UtensilsCrossed);
  });

  it("iconForCategory falls back to HelpCircle for an unmapped category", () => {
    expect(iconForCategory("Not A Real Category")).toBe(HelpCircle);
  });
});
