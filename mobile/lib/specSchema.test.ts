import { describe, it, expect } from "@jest/globals";
import { isIsoDate, normalizeSpec } from "./specSchema";
import {
  buildChartData,
  buildSeriesData,
  filterTransactions,
  findOutlier,
  forecastBuckets,
  resolveSpec,
  summarize,
} from "./logic";
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

  it("only accepts a split by a field with few enough values to draw", () => {
    expect(normalizeSpec({ seriesBy: "account" }).spec.seriesBy).toBe("account");
    const { spec, issues } = normalizeSpec({ seriesBy: "date" });
    expect(spec.seriesBy).toBeNull();
    expect(issues).toEqual(expect.arrayContaining([expect.stringContaining("date")]));
  });

  it("drops a split that repeats the grouping, which is one dimension not two", () => {
    expect(normalizeSpec({ groupBy: "category", seriesBy: "category" }).spec.seriesBy).toBeNull();
  });

  it("treats forecast as strictly opt-in", () => {
    expect(normalizeSpec({}).spec.forecast).toBe(false);
    expect(normalizeSpec({ forecast: "yes" }).spec.forecast).toBe(false);
    expect(normalizeSpec({ forecast: true }).spec.forecast).toBe(true);
  });
});
// The cases above are the malformed specs I thought of. This is for the
// ones I didn't: the guarantee normalizeSpec has to make is not "handles
// these twelve shapes" but "whatever comes back, the app still runs".
// A model under load, a truncated response, a future field name -- all of
// it arrives here first.
describe("normalizeSpec under garbage", () => {
  // Seeded so a failure is reproducible rather than a story about a
  // Tuesday.
  function seeded(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIELDS = [
    "chartType", "groupBy", "type", "metric", "seriesBy", "dateStart", "dateEnd",
    "categories", "excludeCategories", "categoryContains", "payeeContains", "payeeAny",
    "accountContains", "amountMin", "amountMax", "limit", "includeTransfers",
    "recurringOnly", "compareTo", "target", "forecast", "title", "isLedgerQuery",
    "__proto__", "constructor", "toString", "0", "", "a".repeat(200),
  ];

  const VALUES: any[] = [
    null, undefined, true, false, 0, -1, 1e9, -1e9, NaN, Infinity, -Infinity, 0.5,
    "", " ", "yesterday", "2026-02-31", "2026-13-45", "bar", "month", "sum", "x".repeat(5000),
    [], [null], ["a", 1, {}], {}, { nested: { deep: true } }, [[[]]], "null", "[]", "{}",
    "<script>alert(1)</script>", "'; drop table transactions; --", "\u0000", "🙂",
  ];

  const rows = [
    row("2026-01-05", "Chipotle", "Dining:Fast Food", -12),
    row("2026-02-06", "Whole Foods", "Groceries:Super", -80),
    row("2026-03-07", "Payroll", "Income:Salary", 5000),
  ];

  it("never throws, whatever shape the response is", () => {
    const random = seeded(4242);
    for (let i = 0; i < 400; i++) {
      const raw: any = {};
      const fieldCount = Math.floor(random() * 6);
      for (let f = 0; f < fieldCount; f++) {
        raw[FIELDS[Math.floor(random() * FIELDS.length)]] = VALUES[Math.floor(random() * VALUES.length)];
      }
      expect(() => normalizeSpec(raw)).not.toThrow();
    }
  });

  // The point is not that normalizeSpec survives -- it is that what it
  // returns is something the whole pipeline can run without special
  // cases, because nothing downstream re-checks the spec.
  it("returns a spec the rest of the pipeline can run", () => {
    const random = seeded(99);
    for (let i = 0; i < 300; i++) {
      const raw: any = {};
      const fieldCount = Math.floor(random() * 8);
      for (let f = 0; f < fieldCount; f++) {
        raw[FIELDS[Math.floor(random() * FIELDS.length)]] = VALUES[Math.floor(random() * VALUES.length)];
      }
      const { spec, issues } = normalizeSpec(raw);

      expect(Array.isArray(issues)).toBe(true);
      expect(() => {
        const filtered = filterTransactions(rows, spec);
        const resolved = resolveSpec(filtered, spec);
        const data = buildChartData(filtered, resolved);
        forecastBuckets(data, resolved, "2026-08-19");
        buildSeriesData(filtered, resolved);
        summarize(filtered);
        findOutlier(filtered);
        for (const d of data) {
          expect(Number.isFinite(d.total)).toBe(true);
          expect(typeof d.key).toBe("string");
        }
      }).not.toThrow();
    }
  });

  it("never lets a hostile key reach the spec object or its prototype", () => {
    const { spec } = normalizeSpec(JSON.parse('{"__proto__":{"polluted":true},"groupBy":"month"}'));
    expect(({} as any).polluted).toBeUndefined();
    expect((spec as any).polluted).toBeUndefined();
    expect(spec.groupBy).toBe("month");
  });
});
