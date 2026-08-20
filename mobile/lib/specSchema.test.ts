import { describe, it, expect } from "@jest/globals";
import { isIsoDate, normalizeSpec } from "./specSchema";
import { filterTransactions } from "./logic";
import type { Transaction } from "./types";

const row = (Date: string, Payee: string, Category: string, Amount: number): Transaction => ({
  Date,
  Payee,
  Category,
  Amount,
  Id: undefined as any,
  Account: "Manual entry",
  IsTransfer: false,
});

// The spec used to go from JSON.parse straight into the filter. Every
// case here is something a model can plausibly return that the app then
// had no answer for.
describe("normalizeSpec", () => {
  it("keeps a well-formed spec intact", () => {
    const { spec, issues } = normalizeSpec({
      chartType: "line",
      groupBy: "month",
      type: "expense",
      metric: "count",
      dateStart: "2026-01-01",
      dateEnd: "2026-08-19",
      payeeContains: "Chipotle",
      categories: ["Dining & Drinks"],
      limit: 10,
      title: "Chipotle by month",
    });
    expect(issues).toEqual([]);
    expect(spec).toMatchObject({
      chartType: "line",
      groupBy: "month",
      type: "expense",
      metric: "count",
      dateStart: "2026-01-01",
      dateEnd: "2026-08-19",
      payeeContains: "Chipotle",
      categories: ["Dining & Drinks"],
      limit: 10,
      title: "Chipotle by month",
    });
  });

  // The one that motivated all of this: a relative date string sorts
  // above every ISO date, so the filter drops every row and the card
  // reports "no matching transactions" as if that were the answer.
  it("drops a non-ISO date instead of filtering the whole ledger away", () => {
    const rows = [row("2026-08-01", "Chipotle", "Dining", -10)];
    const { spec, issues } = normalizeSpec({ groupBy: "month", dateStart: "yesterday" });

    expect(spec.dateStart).toBeUndefined();
    expect(issues).toContain("ignored an unreadable start date");
    expect(filterTransactions(rows, spec)).toHaveLength(1);
  });

  it("rejects a date that is well-formed but not a real day", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(normalizeSpec({ dateEnd: "2026-02-31" }).spec.dateEnd).toBeUndefined();
  });

  it("flips a backwards date range rather than matching nothing", () => {
    const { spec, issues } = normalizeSpec({ dateStart: "2026-08-01", dateEnd: "2026-01-01" });
    expect(spec.dateStart).toBe("2026-01-01");
    expect(spec.dateEnd).toBe("2026-08-01");
    expect(issues).toContain("the date range was backwards, so it was flipped");
  });

  it("falls back to a drawable default for an unknown grouping or chart type", () => {
    const { spec, issues } = normalizeSpec({ groupBy: "merchant", chartType: "sankey" });
    expect(spec.groupBy).toBe("category");
    expect(spec.chartType).toBe("bar");
    expect(issues).toEqual(expect.arrayContaining([expect.stringContaining("merchant"), expect.stringContaining("sankey")]));
  });

  it("caps a runaway limit", () => {
    const { spec, issues } = normalizeSpec({ groupBy: "transaction", limit: 5000 });
    expect(spec.limit).toBe(50);
    expect(issues).toContain("a limit of 5000 was capped to 50");
    expect(normalizeSpec({ limit: 0 }).spec.limit).toBe(1);
  });

  it("accepts a bare string where a list of categories belongs", () => {
    expect(normalizeSpec({ categories: "Groceries" }).spec.categories).toEqual(["Groceries"]);
    expect(normalizeSpec({ categories: [] }).spec.categories).toBeNull();
    expect(normalizeSpec({ categories: [null, "  Dining  ", ""] }).spec.categories).toEqual(["Dining"]);
  });

  it("coerces numeric strings and flips a backwards amount range", () => {
    const { spec, issues } = normalizeSpec({ amountMin: "100", amountMax: "20" });
    expect(spec.amountMin).toBe(20);
    expect(spec.amountMax).toBe(100);
    expect(issues).toContain("the amount range was backwards, so it was flipped");
  });

  it("takes the magnitude of a negative amount bound, since the filter compares magnitudes", () => {
    expect(normalizeSpec({ amountMin: -50 }).spec.amountMin).toBe(50);
  });

  it("reports an unreadable amount rather than filtering on NaN", () => {
    const { spec, issues } = normalizeSpec({ amountMin: "about fifty" });
    expect(spec.amountMin).toBeNull();
    expect(issues).toContain("ignored an unreadable minimum amount");
  });

  it("bounds the strings that get rendered into the card", () => {
    const { spec } = normalizeSpec({ title: "x".repeat(500), payeeContains: "y".repeat(500) });
    expect(spec.title).toHaveLength(80);
    expect(spec.payeeContains).toHaveLength(100);
  });

  it("treats includeTransfers as strictly opt-in", () => {
    expect(normalizeSpec({}).spec.includeTransfers).toBe(false);
    expect(normalizeSpec({ includeTransfers: "yes" }).spec.includeTransfers).toBe(false);
    expect(normalizeSpec({ includeTransfers: true }).spec.includeTransfers).toBe(true);
  });

  it("survives a response that isn't an object at all", () => {
    const { spec, issues } = normalizeSpec("nope");
    expect(spec.groupBy).toBe("category");
    expect(issues).toContain("the answer wasn't a query, so nothing was filtered");
    expect(normalizeSpec(null).spec.chartType).toBe("bar");
  });

  it("ignores fields the app doesn't know about", () => {
    const { spec } = normalizeSpec({ groupBy: "month", sqlInjection: "drop table", __proto__: { evil: true } });
    expect((spec as any).sqlInjection).toBeUndefined();
    expect((spec as any).evil).toBeUndefined();
  });
});
