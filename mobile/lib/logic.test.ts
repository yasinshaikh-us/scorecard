import { describe, it, expect } from "@jest/globals";
import {
  budgetProgress,
  comparePrevious,
  filterRecurring,
  median,
  recurringPayees,
  topCategory,
  computeDataMeta,
  filterTransactions,
  groupKeyOf,
  buildChartData,
  capPieSlices,
  chartTypeForGranularity,
  cleanRows,
  findOutlier,
  granularityForSpan,
  metricValue,
  parseQueryResponse,
  resolveSpec,
  spanDays,
  summarize,
} from "./logic";
import type { Transaction } from "./types";

// Ported from /src/logic.test.js -- same cases, since lib/logic.ts is a
// behaviorally-identical port of /src/logic.js's filter/group/chart-data
// logic. computeDataMeta here only returns { CATS } (mobile doesn't
// build the system prompt client-side, so SUBCATS/MIN_DATE/MAX_DATE
// aren't needed) -- those cases are intentionally not ported.

const row = (Date: string, Payee: string, Category: string, Amount: number): Transaction => ({
  Date,
  Payee,
  Category,
  Amount,
  Id: undefined as any,
  Account: "Manual entry",
  IsTransfer: false,
});

describe("topCategory", () => {
  it("splits Top:Sub on the first colon", () => {
    expect(topCategory("Home:Rent")).toBe("Home");
    expect(topCategory("Auto & Transport:Car Insurance")).toBe("Auto & Transport");
  });
  it("returns the whole string when there's no colon", () => {
    expect(topCategory("Groceries")).toBe("Groceries");
  });
  it("falls back to Uncategorized for null/undefined/empty", () => {
    expect(topCategory(null as any)).toBe("Uncategorized");
    expect(topCategory(undefined as any)).toBe("Uncategorized");
    expect(topCategory("")).toBe("Uncategorized");
  });
});

describe("computeDataMeta", () => {
  it("returns an empty CATS for an empty dataset", () => {
    expect(computeDataMeta([])).toEqual({ CATS: [] });
  });

  it("dedupes top-level categories in first-seen order", () => {
    const rows = [
      row("2024-01-01", "A", "Home:Rent", -1),
      row("2024-01-02", "B", "Groceries", -2),
      row("2024-01-03", "C", "Home:Mortgage", -3),
      row("2024-01-04", "D", "Home:Rent", -4),
    ];
    expect(computeDataMeta(rows).CATS).toEqual(["Home", "Groceries"]);
  });
});

describe("cleanRows", () => {
  it("drops rows missing a required field", () => {
    const rows = [
      row("2026-01-01", "Good Payee", "Groceries", -10),
      row("2026-01-02", "No Category", null as any, -20),
      { Date: "2026-01-03", Payee: "No Amount", Category: "Home", Amount: null },
      { Date: "2026-01-04", Payee: "NaN Amount", Category: "Home", Amount: "not-a-number" },
      row(null as any, "No Date", "Home", -5),
      row("2026-01-05", null as any, "Home", -6),
    ];
    const out = cleanRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].Payee).toBe("Good Payee");
  });

  it("trims strings and coerces Amount to a number", () => {
    const out = cleanRows([{ Date: " 2026-01-01 ", Payee: " Chipotle ", Category: " Dining ", Amount: "-12.50" }]);
    expect(out).toEqual([
      { Date: "2026-01-01", Payee: "Chipotle", Category: "Dining", Amount: -12.5, Account: "Manual entry", IsTransfer: false },
    ]);
  });

  it("defaults Account to 'Manual entry' and IsTransfer to false when absent", () => {
    const out = cleanRows([row("2026-01-01", "Chipotle", "Dining", -12.5)]);
    expect(out[0].Account).toBe("Manual entry");
    expect(out[0].IsTransfer).toBe(false);
  });

  it("passes Id through unchanged when present, and leaves it undefined when absent", () => {
    const withId = cleanRows([{ Id: 42, Date: "2026-01-01", Payee: "Chipotle", Category: "Dining", Amount: -12.5 }]);
    expect(withId[0].Id).toBe(42);
    const withoutId = cleanRows([row("2026-01-01", "Chipotle", "Dining", -12.5)]);
    expect(withoutId[0].Id).toBeUndefined();
  });

  it("keeps a zero Amount (falsy, but valid)", () => {
    const out = cleanRows([row("2026-01-01", "Free Sample", "Groceries", 0)]);
    expect(out).toHaveLength(1);
  });
});

describe("parseQueryResponse", () => {
  it("extracts a plain string error from a non-ok response", () => {
    expect(parseQueryResponse(false, { error: "Unauthorized" })).toEqual({ error: "Unauthorized" });
  });

  it("extracts Anthropic's nested error.error.message shape from a non-ok response", () => {
    const data = { error: { type: "error", error: { message: "rate limited" } } };
    expect(parseQueryResponse(false, data)).toEqual({ error: "rate limited" });
  });

  it("falls back to a generic message when a non-ok response has no recognizable error shape", () => {
    expect(parseQueryResponse(false, {})).toEqual({ error: "Request failed" });
  });

  it("returns offTopic for an isLedgerQuery: false response", () => {
    const data = { content: [{ type: "text", text: '{"isLedgerQuery": false}' }] };
    expect(parseQueryResponse(true, data)).toEqual({ offTopic: true });
  });

  // The spec is rebuilt field by field rather than passed through (see
  // lib/specSchema.ts), so the response's own keys don't survive as-is:
  // what comes back is exactly what the app is willing to run.
  it("returns a normalized spec for a well-formed ledger query response", () => {
    const data = { content: [{ type: "text", text: '{"isLedgerQuery": true, "chartType": "bar"}' }] };
    const result: any = parseQueryResponse(true, data);
    expect(result.issues).toEqual([]);
    expect(result.spec).toMatchObject({ chartType: "bar", groupBy: "category", type: "all", metric: "sum" });
    expect(result.spec.isLedgerQuery).toBeUndefined();
  });

  it("strips markdown code fences before parsing", () => {
    const data = { content: [{ type: "text", text: '```json\n{"isLedgerQuery": false}\n```' }] };
    expect(parseQueryResponse(true, data)).toEqual({ offTopic: true });
  });

  it("errors instead of throwing when there's no text content block", () => {
    expect(parseQueryResponse(true, { content: [] })).toEqual({ error: "Claude did not return a text response." });
    expect(parseQueryResponse(true, {})).toEqual({ error: "Claude did not return a text response." });
  });

  it("errors instead of throwing when the text block isn't valid JSON", () => {
    const data = { content: [{ type: "text", text: "not json" }] };
    const result: any = parseQueryResponse(true, data);
    expect(result.error).toBeTruthy();
    expect(result.spec).toBeUndefined();
  });
});

describe("filterTransactions", () => {
  const rows = [
    row("2026-01-01", "Chase Mortgage", "Home:Mortgage", -5712.04),
    row("2026-01-03", "Amli Spring District", "Home:Rent", -3100),
    row("2026-01-05", "Alimony", "Home", -1770),
    row("2026-02-01", "Chipotle", "Dining & Drinks:Restaurants", -21.95),
    row("2026-02-10", "QFC Foods", "Groceries", -45.5),
    row("2026-03-01", "Paycheck", "Personal Income:Paycheck", 4000),
  ];

  it("returns nothing for a null spec", () => {
    expect(filterTransactions(rows, null)).toEqual([]);
  });

  it("filters by top-level categories array", () => {
    const out = filterTransactions(rows, { categories: ["Home"] });
    expect(out.map((r) => r.Payee).sort()).toEqual(["Alimony", "Amli Spring District", "Chase Mortgage"]);
  });

  it("categoryContains isolates a subcategory without matching sibling subcategories", () => {
    const out = filterTransactions(rows, { categoryContains: "rent" });
    expect(out.map((r) => r.Payee)).toEqual(["Amli Spring District"]);
  });

  it("payeeContains matches case-insensitively", () => {
    const out = filterTransactions(rows, { payeeContains: "chipotle" });
    expect(out.map((r) => r.Payee)).toEqual(["Chipotle"]);
  });

  it("filters by dateStart/dateEnd inclusively", () => {
    const out = filterTransactions(rows, { dateStart: "2026-01-03", dateEnd: "2026-02-01" });
    expect(out.map((r) => r.Payee)).toEqual(["Amli Spring District", "Alimony", "Chipotle"]);
  });

  it("filters by type expense/income", () => {
    expect(filterTransactions(rows, { type: "income" }).map((r) => r.Payee)).toEqual(["Paycheck"]);
    expect(filterTransactions(rows, { type: "expense" }).length).toBe(5);
  });

  it("filters by amountMin/amountMax on absolute value", () => {
    const out = filterTransactions(rows, { amountMin: 100, amountMax: 4000 });
    expect(out.map((r) => r.Payee).sort()).toEqual(["Alimony", "Amli Spring District", "Paycheck"]);
  });

  it("combines multiple filters", () => {
    const out = filterTransactions(rows, { categoryContains: "mortgage", type: "expense" });
    expect(out.map((r) => r.Payee)).toEqual(["Chase Mortgage"]);
  });

  describe("multi-account fields (Account, IsTransfer)", () => {
    const multiAccountRows = [
      { ...row("2026-01-01", "Chipotle", "Dining & Drinks:Restaurants", -21.95), Account: "Chase Checking ••1234", IsTransfer: false },
      { ...row("2026-01-02", "Paycheck", "Personal Income:Paycheck", 4000), Account: "Chase Checking ••1234", IsTransfer: false },
      { ...row("2026-01-03", "Transfer to Savings", "Transfer", -1000), Account: "Chase Checking ••1234", IsTransfer: true },
      { ...row("2026-01-03", "Transfer from Checking", "Transfer", 1000), Account: "Ally Savings ••5678", IsTransfer: true },
    ];

    it("excludes IsTransfer rows by default, even for type 'all'", () => {
      const out = filterTransactions(multiAccountRows, { type: "all" });
      expect(out.map((r) => r.Payee).sort()).toEqual(["Chipotle", "Paycheck"]);
    });

    it("includes IsTransfer rows when includeTransfers is true", () => {
      const out = filterTransactions(multiAccountRows, { type: "all", includeTransfers: true });
      expect(out.length).toBe(4);
    });

    it("type 'transfer' returns only IsTransfer rows, regardless of includeTransfers", () => {
      const out = filterTransactions(multiAccountRows, { type: "transfer" });
      expect(out.map((r) => r.Payee).sort()).toEqual(["Transfer from Checking", "Transfer to Savings"]);
    });

    it("accountContains matches case-insensitively against Account", () => {
      const out = filterTransactions(multiAccountRows, { type: "all", accountContains: "savings" });
      expect(out).toEqual([]);
      const out2 = filterTransactions(multiAccountRows, { type: "all", accountContains: "savings", includeTransfers: true });
      expect(out2.map((r) => r.Payee)).toEqual(["Transfer from Checking"]);
    });
  });
});

describe("groupKeyOf", () => {
  it("groups by top-level category", () => {
    expect(groupKeyOf({ groupBy: "category" }, row("2026-01-01", "X", "Home:Rent", -1))).toBe("Home");
  });
  it("groups by payee", () => {
    expect(groupKeyOf({ groupBy: "payee" }, row("2026-01-01", "Chipotle", "Dining", -1))).toBe("Chipotle");
  });
  it("groups by account", () => {
    const d = { ...row("2026-01-01", "Chipotle", "Dining", -1), Account: "Chase Checking ••1234" };
    expect(groupKeyOf({ groupBy: "account" }, d)).toBe("Chase Checking ••1234");
  });
  it("falls back to 'Manual entry' grouping by account when Account is missing", () => {
    expect(groupKeyOf({ groupBy: "account" }, { ...row("2026-01-01", "Chipotle", "Dining", -1), Account: "" })).toBe("Manual entry");
  });
  it("groups by day (the raw date)", () => {
    expect(groupKeyOf({ groupBy: "day" }, row("2026-01-01", "X", "Home", -1))).toBe("2026-01-01");
  });
  it("groups by month (YYYY-MM)", () => {
    expect(groupKeyOf({ groupBy: "month" }, row("2026-01-15", "X", "Home", -1))).toBe("2026-01");
  });
  it("groups by week, rounding down to that week's Sunday", () => {
    expect(groupKeyOf({ groupBy: "week" }, row("2026-01-15", "X", "Home", -1))).toBe("2026-01-11");
  });
  it("computes the same week-start regardless of the runtime's local timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const negativeOffset = groupKeyOf({ groupBy: "week" }, row("2026-01-15", "X", "Home", -1));
      process.env.TZ = "Asia/Kolkata";
      const positiveOffset = groupKeyOf({ groupBy: "week" }, row("2026-01-15", "X", "Home", -1));
      expect(positiveOffset).toBe(negativeOffset);
      expect(positiveOffset).toBe("2026-01-11");
    } finally {
      process.env.TZ = original;
    }
  });
  it("returns empty string for a null spec or unknown groupBy", () => {
    expect(groupKeyOf(null, row("2026-01-01", "X", "Home", -1))).toBe("");
    expect(groupKeyOf({ groupBy: "none" }, row("2026-01-01", "X", "Home", -1))).toBe("");
  });
  it("groups by transaction: payee + formatted date, one key per individual transaction", () => {
    expect(groupKeyOf({ groupBy: "transaction" }, row("2026-01-15", "Chipotle", "Dining", -12))).toBe("Chipotle — 15 Jan 26");
  });
});

describe("buildChartData", () => {
  const rows = [
    row("2026-01-05", "A", "Home:Rent", -100),
    row("2026-01-20", "B", "Groceries", -50),
    row("2026-02-01", "C", "Home:Mortgage", -5000),
  ];

  it("returns nothing for a null spec or groupBy 'none'", () => {
    expect(buildChartData(rows, null)).toEqual([]);
    expect(buildChartData(rows, { groupBy: "none" })).toEqual([]);
  });

  it("sorts date-keyed groupings chronologically", () => {
    const out = buildChartData(rows, { groupBy: "month" });
    expect(out.map((d) => d.key)).toEqual(["2026-01", "2026-02"]);
  });

  it("sorts non-date groupings by total descending", () => {
    const out = buildChartData(rows, { groupBy: "category" });
    expect(out.map((d) => d.key)).toEqual(["Home", "Groceries"]);
    expect(out[0].total).toBe(5100);
  });

  it("caps payee grouping to the top 10 by total when no limit is given", () => {
    const manyPayees = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
    const out = buildChartData(manyPayees, { groupBy: "payee" });
    expect(out.length).toBe(10);
    expect(out[0].key).toBe("Payee14");
  });

  it("respects an explicit limit for payee grouping instead of the default 10", () => {
    const manyPayees = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
    const out = buildChartData(manyPayees, { groupBy: "payee", limit: 3 });
    expect(out.length).toBe(3);
    expect(out.map((d) => d.key)).toEqual(["Payee14", "Payee13", "Payee12"]);
  });

  it("does not cap category/account groupings by default, but does when an explicit limit is given", () => {
    const manyCategories = Array.from({ length: 15 }, (_, i) => row("2026-01-01", "X", `Cat${i}:Sub`, -(i + 1)));
    expect(buildChartData(manyCategories, { groupBy: "category" }).length).toBe(15);
    const capped = buildChartData(manyCategories, { groupBy: "category", limit: 3 });
    expect(capped.length).toBe(3);
    expect(capped.map((d) => d.key)).toEqual(["Cat14", "Cat13", "Cat12"]);
  });

  describe("groupBy 'transaction' (ranking individual transactions by size)", () => {
    it("ranks each transaction individually instead of summing same-payee transactions together", () => {
      const rows2 = [
        row("2026-01-05", "Chipotle", "Dining", -12),
        row("2026-01-10", "Chipotle", "Dining", -8),
        row("2026-01-15", "Rent Co", "Home:Rent", -2000),
      ];
      const out = buildChartData(rows2, { groupBy: "transaction" });
      expect(out.length).toBe(3);
      expect(out.map((d) => d.total)).toEqual([2000, 12, 8]);
    });

    it("defaults to the top 10 individual transactions when no limit is given", () => {
      const rows2 = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
      const out = buildChartData(rows2, { groupBy: "transaction" });
      expect(out.length).toBe(10);
      expect(out[0].total).toBe(15);
    });

    it("respects an explicit limit", () => {
      const rows2 = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
      const out = buildChartData(rows2, { groupBy: "transaction", limit: 5 });
      expect(out.length).toBe(5);
    });

    it("each entry carries the original row, so the list below the chart can show exactly this ranked set", () => {
      const target = row("2026-01-05", "Chipotle", "Dining", -12);
      const out = buildChartData([target], { groupBy: "transaction" });
      expect(out[0].row).toBe(target);
    });
  });
});


// Everything below covers the "one bar holding six years of spending"
// class of defect: a question that filters to a single merchant used to
// group by category, collapse to one bucket, and report a total with no
// span, no trend and no frequency.

describe("quarter and year grouping", () => {
  const spec = (groupBy: any) => ({ groupBy }) as any;

  it("keys a quarter as YYYY-Qn", () => {
    expect(groupKeyOf(spec("quarter"), row("2026-01-15", "A", "Groceries", -5))).toBe("2026-Q1");
    expect(groupKeyOf(spec("quarter"), row("2026-03-31", "A", "Groceries", -5))).toBe("2026-Q1");
    expect(groupKeyOf(spec("quarter"), row("2026-04-01", "A", "Groceries", -5))).toBe("2026-Q2");
    expect(groupKeyOf(spec("quarter"), row("2026-12-31", "A", "Groceries", -5))).toBe("2026-Q4");
  });

  it("keys a year as YYYY", () => {
    expect(groupKeyOf(spec("year"), row("2026-08-19", "A", "Groceries", -5))).toBe("2026");
  });

  it("sorts quarter and year buckets chronologically, like the other date groupings", () => {
    const rows = [
      row("2024-05-01", "A", "Groceries", -10),
      row("2026-02-01", "A", "Groceries", -30),
      row("2025-08-01", "A", "Groceries", -20),
    ];
    expect(buildChartData(rows, { groupBy: "quarter" } as any).map((d) => d.key)).toEqual([
      "2024-Q2",
      "2025-Q3",
      "2026-Q1",
    ]);
    expect(buildChartData(rows, { groupBy: "year" } as any).map((d) => d.key)).toEqual(["2024", "2025", "2026"]);
  });
});

describe("granularityForSpan", () => {
  it("climbs from day to year as the span grows", () => {
    expect(granularityForSpan(10)).toBe("day");
    expect(granularityForSpan(60)).toBe("week");
    expect(granularityForSpan(365)).toBe("month");
    // ~6.5 years of ledger: 78 monthly points, 26 quarterly ones.
    expect(granularityForSpan(6.5 * 365)).toBe("quarter");
    expect(granularityForSpan(12 * 365)).toBe("year");
  });

  it("pairs discrete buckets with bars and trends with a line", () => {
    expect(chartTypeForGranularity("day")).toBe("bar");
    expect(chartTypeForGranularity("week")).toBe("bar");
    expect(chartTypeForGranularity("month")).toBe("line");
    expect(chartTypeForGranularity("quarter")).toBe("line");
    expect(chartTypeForGranularity("year")).toBe("line");
  });
});

describe("spanDays", () => {
  it("measures first to last date, whatever order the rows arrive in", () => {
    const rows = [row("2026-03-01", "A", "Groceries", -1), row("2026-01-01", "A", "Groceries", -1)];
    expect(spanDays(rows)).toBe(59);
    expect(spanDays([])).toBe(0);
  });
});

describe("resolveSpec", () => {
  // The Chipotle case, in miniature: one merchant, one category, so a
  // category grouping is a single bar covering the whole span.
  const chipotle = [
    row("2025-01-05", "Chipotle", "Dining & Drinks:Restaurants", -13.95),
    row("2025-06-05", "Chipotle", "Dining & Drinks:Restaurants", -21.95),
    row("2026-08-05", "Chipotle", "Dining & Drinks:Fast Food", -10.97),
  ];

  it("re-groups a single-bucket category chart over time", () => {
    const spec = { groupBy: "category", chartType: "bar", payeeContains: "Chipotle" } as any;
    const resolved = resolveSpec(chipotle, spec)!;
    expect(resolved.groupBy).toBe("month");
    expect(resolved.chartType).toBe("line");
    expect(buildChartData(chipotle, resolved).length).toBe(3);
  });

  it("leaves a grouping that already has more than one bucket alone", () => {
    const rows = [
      row("2026-01-05", "Whole Foods", "Groceries:Supermarket", -50),
      row("2026-01-06", "Chipotle", "Dining & Drinks:Fast Food", -12),
    ];
    const spec = { groupBy: "category", chartType: "bar" } as any;
    expect(resolveSpec(rows, spec)).toBe(spec);
  });

  it("leaves rankings, empty results and single rows alone", () => {
    const spec = { groupBy: "transaction", chartType: "bar" } as any;
    expect(resolveSpec(chipotle, spec)).toBe(spec);
    const categorySpec = { groupBy: "category", chartType: "bar" } as any;
    expect(resolveSpec([], categorySpec)).toBe(categorySpec);
    // A single transaction has no trend to expose; the stat line says it all.
    expect(resolveSpec(chipotle.slice(0, 1), categorySpec)).toBe(categorySpec);
  });

  it("does not re-group when the data is already at that granularity", () => {
    const sameDay = [
      row("2026-08-05", "Chipotle", "Dining & Drinks:Fast Food", -10),
      row("2026-08-05", "Chipotle", "Dining & Drinks:Fast Food", -12),
    ];
    const spec = { groupBy: "day", chartType: "bar" } as any;
    expect(resolveSpec(sameDay, spec)).toBe(spec);
  });
});

describe("metric", () => {
  const rows = [
    row("2026-01-05", "Chipotle", "Dining & Drinks:Fast Food", -10),
    row("2026-01-06", "Chipotle", "Dining & Drinks:Fast Food", -30),
    row("2026-02-06", "Chipotle", "Dining & Drinks:Fast Food", -20),
  ];

  it("sums by default", () => {
    const data = buildChartData(rows, { groupBy: "month" } as any);
    expect(data.map((d) => d.total)).toEqual([40, 20]);
  });

  it("counts transactions under metric 'count', leaving sum available for the stat line", () => {
    const data = buildChartData(rows, { groupBy: "month", metric: "count" } as any);
    expect(data.map((d) => d.total)).toEqual([2, 1]);
    expect(data.map((d) => d.sum)).toEqual([40, 20]);
  });

  it("averages the bucket under metric 'avg'", () => {
    const data = buildChartData(rows, { groupBy: "month", metric: "avg" } as any);
    expect(data.map((d) => d.total)).toEqual([20, 20]);
  });

  it("never divides by zero for an empty bucket", () => {
    expect(metricValue({ sum: 0, count: 0 }, "avg")).toBe(0);
  });
});

describe("excludeCategories", () => {
  it("drops a top-level bucket from an otherwise-matching set", () => {
    const rows = [
      row("2026-01-05", "Bitcoin", "Investments:Crypto", -170000),
      row("2026-01-06", "Whole Foods", "Groceries:Supermarket", -50),
    ];
    const kept = filterTransactions(rows, { excludeCategories: ["Investments"] } as any);
    expect(kept.map((d) => d.Payee)).toEqual(["Whole Foods"]);
  });
});

describe("capPieSlices", () => {
  const datum = (key: string, sum: number) => ({ key, total: sum, sum, count: 1 });

  it("leaves a readable pie alone", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((k, i) => datum(k, 60 - i));
    expect(capPieSlices(six, "sum")).toHaveLength(6);
  });

  it("folds the tail into one Other slice that remembers what it swallowed", () => {
    const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((k, i) => datum(k, 90 - i * 10));
    const capped = capPieSlices(nine, "sum");
    expect(capped).toHaveLength(6);
    expect(capped[5].key).toBe("Other");
    // f(40) + g(30) + h(20) + i(10)
    expect(capped[5].sum).toBe(100);
    expect(capped[5].count).toBe(4);
    expect(capped[5].keys).toEqual(["f", "g", "h", "i"]);
  });

  it("applies through buildChartData for a pie, but not for a bar", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row("2026-01-0" + ((i % 9) + 1), `Payee ${i}`, `Cat${i}:Sub`, -(i + 1) * 10)
    );
    const pie = buildChartData(rows, { groupBy: "category", chartType: "pie" } as any);
    expect(pie).toHaveLength(6);
    expect(pie[5].key).toBe("Other");
    const bar = buildChartData(rows, { groupBy: "category", chartType: "bar" } as any);
    expect(bar).toHaveLength(9);
  });
});

describe("parseQueryResponse normalization", () => {
  const respond = (text: string) => parseQueryResponse(true, { content: [{ type: "text", text }] });

  it("normalizes the spec rather than trusting the model's JSON", () => {
    const result: any = respond('{"isLedgerQuery":true,"groupBy":"merchant","limit":9999,"dateStart":"yesterday"}');
    expect(result.spec.groupBy).toBe("category");
    expect(result.spec.limit).toBe(50);
    expect(result.spec.dateStart).toBeUndefined();
    expect(result.issues.length).toBe(3);
  });

  it("still reports an off-topic question as off-topic", () => {
    expect(respond('{"isLedgerQuery":false}')).toEqual({ offTopic: true });
  });

  it("carries an empty issue list for a clean spec", () => {
    const result: any = respond('{"isLedgerQuery":true,"groupBy":"month","chartType":"line"}');
    expect(result.issues).toEqual([]);
  });
});

describe("summarize", () => {
  const rows = [
    row("2026-01-01", "Chipotle", "Dining & Drinks:Fast Food", -10),
    row("2026-07-01", "Chipotle", "Dining & Drinks:Fast Food", -20),
    row("2026-04-01", "Chipotle", "Dining & Drinks:Fast Food", -30),
  ];

  it("reports the scalar answer the card never had", () => {
    const s = summarize(rows)!;
    expect(s.sum).toBe(60);
    expect(s.count).toBe(3);
    expect(s.average).toBe(20);
    expect(s.start).toBe("2026-01-01");
    expect(s.end).toBe("2026-07-01");
    expect(s.months).toBeCloseTo(181 / 30.44, 5);
    expect(s.perMonth).toBeCloseTo(60 / (181 / 30.44), 5);
  });

  it("never divides a single-day result by a zero-length span", () => {
    const oneDay = [row("2026-01-01", "A", "Groceries", -10)];
    const s = summarize(oneDay)!;
    expect(s.months).toBe(1);
    expect(s.perMonth).toBe(10);
  });

  it("returns null for no matches", () => {
    expect(summarize([])).toBeNull();
  });
});

describe("findOutlier", () => {
  it("names the single transaction that is most of the total", () => {
    const rows = [
      row("2025-07-01", "Bitcoin", "Investments:Crypto", -170000),
      row("2025-07-02", "Whole Foods", "Groceries:Supermarket", -50),
      row("2025-07-03", "Chipotle", "Dining & Drinks:Fast Food", -12),
      row("2025-07-04", "Shell", "Auto & Transport:Gas & Fuel", -40),
    ];
    const outlier = findOutlier(rows)!;
    expect(outlier.rows).toBe(1);
    expect(outlier.payee).toBe("Bitcoin");
    expect(outlier.amount).toBe(170000);
    expect(outlier.share).toBeGreaterThan(0.99);
  });

  it("falls back to the top three when no single row dominates", () => {
    const rows = [
      row("2026-01-01", "A", "Groceries", -100),
      row("2026-01-02", "B", "Groceries", -90),
      row("2026-01-03", "C", "Groceries", -80),
      row("2026-01-04", "D", "Groceries", -20),
      row("2026-01-05", "E", "Groceries", -20),
      row("2026-01-06", "F", "Groceries", -20),
    ];
    const outlier = findOutlier(rows)!;
    expect(outlier.rows).toBe(3);
    expect(outlier.share).toBeCloseTo(270 / 330, 5);
  });

  it("says nothing about an evenly spread set, or one too small to judge", () => {
    const even = Array.from({ length: 10 }, (_, i) => row(`2026-01-0${(i % 9) + 1}`, "A", "Groceries", -20));
    expect(findOutlier(even)).toBeNull();
    expect(findOutlier([row("2026-01-01", "A", "Groceries", -20)])).toBeNull();
  });
});


// Question shapes the spec vocabulary could not express before: net
// cashflow, the typical case, several merchants at once, subscriptions,
// period-over-period, and a budget.

describe("net and median metrics", () => {
  const mixed = [
    { ...row("2026-01-05", "Payroll", "Income:Salary", 3000) },
    { ...row("2026-01-06", "Rent", "Home:Rent", -2000) },
    { ...row("2026-01-07", "Chipotle", "Dining:Fast Food", -100) },
  ];

  it("nets income against spending, and can go negative", () => {
    const data = buildChartData(mixed, { groupBy: "month", metric: "net", type: "all" } as any);
    expect(data[0].total).toBe(900);
    expect(data[0].sum).toBe(5100);

    const spendOnly = buildChartData(mixed.slice(1), { groupBy: "month", metric: "net", type: "all" } as any);
    expect(spendOnly[0].total).toBe(-2100);
  });

  it("takes the middle amount for median, not the mean a single big row drags", () => {
    expect(median([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBe(0);

    const groceries = [
      row("2026-01-01", "Store", "Groceries", -40),
      row("2026-01-02", "Store", "Groceries", -50),
      row("2026-01-03", "Store", "Groceries", -60),
      row("2026-01-04", "Store", "Groceries", -800),
    ];
    const [bucket] = buildChartData(groceries, { groupBy: "month", metric: "median" } as any);
    expect(bucket.total).toBe(55);
    // The mean would have said $237.50.
    expect(bucket.sum / bucket.count).toBeCloseTo(237.5, 5);
  });
});

describe("payeeAny", () => {
  const rows = [
    row("2026-01-01", "Chipotle Mexican Grill", "Dining", -12),
    row("2026-01-02", "Sweetgreen", "Dining", -15),
    row("2026-01-03", "Whole Foods", "Groceries", -80),
  ];

  it("matches any one of several merchants", () => {
    const kept = filterTransactions(rows, { payeeAny: ["chipotle", "sweetgreen"] } as any);
    expect(kept.map((r) => r.Payee)).toEqual(["Chipotle Mexican Grill", "Sweetgreen"]);
  });

  it("is ignored when empty, rather than matching nothing", () => {
    expect(filterTransactions(rows, { payeeAny: [] } as any)).toHaveLength(3);
  });
});

describe("recurringPayees", () => {
  const monthly = (payee: string, amount: number, months: number[], day = "05") =>
    months.map((m) => row(`2026-${String(m).padStart(2, "0")}-${day}`, payee, "Bills:Subscriptions", -amount));

  it("finds a monthly subscription and reports its cadence and cost", () => {
    const found = recurringPayees(monthly("Netflix", 15.99, [1, 2, 3, 4, 5]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ payee: "Netflix", cadence: "monthly", count: 5 });
    expect(found[0].amount).toBeCloseTo(15.99, 2);
    expect(found[0].perMonth).toBeCloseTo(15.99, 2);
  });

  it("finds a weekly one and prices it per month", () => {
    const weekly = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"].map((d) =>
      row(d, "Cleaner", "Home:Services", -80)
    );
    const [found] = recurringPayees(weekly);
    expect(found.cadence).toBe("weekly");
    expect(found.perMonth).toBeCloseTo(80 * (30.44 / 7), 2);
  });

  it("finds a yearly one", () => {
    const yearly = ["2024-03-01", "2025-03-02", "2026-03-01"].map((d) => row(d, "Domain", "Bills", -22));
    expect(recurringPayees(yearly)[0]).toMatchObject({ cadence: "yearly" });
  });

  // The median gap here is 8.5 days, which lands inside the weekly
  // window even though the actual gaps are 1, 15, 39 and 2 -- regularity
  // has to be checked, not inferred from a middle value.
  it("ignores a merchant visited often but irregularly", () => {
    const chipotle = ["2026-01-03", "2026-01-04", "2026-01-19", "2026-02-27", "2026-03-01"].map((d) =>
      row(d, "Chipotle", "Dining", -13)
    );
    expect(recurringPayees(chipotle)).toEqual([]);
  });

  it("ignores a regular cadence whose amount swings wildly", () => {
    const utility = [
      row("2026-01-05", "Casino", "Entertainment", -20),
      row("2026-02-05", "Casino", "Entertainment", -400),
      row("2026-03-05", "Casino", "Entertainment", -5),
      row("2026-04-05", "Casino", "Entertainment", -900),
    ];
    expect(recurringPayees(utility)).toEqual([]);
  });

  it("needs at least three charges before calling anything recurring", () => {
    expect(recurringPayees(monthly("Netflix", 15.99, [1, 2]))).toEqual([]);
  });

  it("narrows a set to recurring payees only when the spec asks", () => {
    const rows = [...monthly("Netflix", 15.99, [1, 2, 3]), row("2026-01-08", "Chipotle", "Dining", -12)];
    expect(filterRecurring(rows, { recurringOnly: true } as any).map((r) => r.Payee)).toEqual([
      "Netflix",
      "Netflix",
      "Netflix",
    ]);
    expect(filterRecurring(rows, {} as any)).toHaveLength(4);
  });

  it("ranks the most expensive subscription first", () => {
    const rows = [...monthly("Netflix", 15.99, [1, 2, 3]), ...monthly("Storage", 60, [1, 2, 3], "12")];
    expect(recurringPayees(rows).map((r) => r.payee)).toEqual(["Storage", "Netflix"]);
  });
});

describe("comparePrevious", () => {
  const all = [
    // Previous window: January.
    row("2026-01-10", "Store", "Groceries", -100),
    row("2026-01-20", "Store", "Groceries", -100),
    // Current window: February.
    row("2026-02-10", "Store", "Groceries", -150),
    row("2026-02-20", "Store", "Groceries", -150),
  ];
  const spec = { dateStart: "2026-02-01", dateEnd: "2026-02-28", compareTo: "previous" } as any;

  it("measures the equal-length window immediately before, and the delta", () => {
    const current = summarize(filterTransactions(all, spec))!;
    const previous = comparePrevious(all, spec, current)!;
    // Feb 1-28 is a 27-day span, so the window before it is 4-31 Jan.
    expect(previous.start).toBe("2026-01-04");
    expect(previous.end).toBe("2026-01-31");
    expect(previous.sum).toBe(200);
    expect(previous.deltaPct).toBeCloseTo(0.5, 5);
  });

  it("reports no percentage when the previous window is empty", () => {
    const emptyBefore = [row("2026-02-10", "Store", "Groceries", -150)];
    const current = summarize(filterTransactions(emptyBefore, spec))!;
    expect(comparePrevious(emptyBefore, spec, current)).toMatchObject({ sum: 0, deltaPct: null });
  });

  it("says nothing unless the question asked for a comparison", () => {
    const current = summarize(all)!;
    expect(comparePrevious(all, { ...spec, compareTo: null }, current)).toBeNull();
    expect(comparePrevious(all, spec, null)).toBeNull();
  });

  it("falls back to the matching rows' own window when the spec has no bounds", () => {
    const unbounded = { compareTo: "previous" } as any;
    const current = summarize(filterTransactions(all, unbounded))!;
    const previous = comparePrevious(all, unbounded, current)!;
    // Rows span 10 Jan - 20 Feb (41 days), so the window before it ends 9 Jan.
    expect(previous.end).toBe("2026-01-09");
    expect(previous.start).toBe("2025-11-29");
  });
});

describe("budgetProgress", () => {
  const summary = (sum: number, end: string) => ({
    sum,
    count: 3,
    average: sum / 3,
    perMonth: sum,
    start: "2026-02-01",
    end,
    months: 1,
  });

  it("measures spend against the named target", () => {
    const progress = budgetProgress(summary(312, "2026-02-11"), {
      target: 500,
      dateStart: "2026-02-01",
      dateEnd: "2026-02-28",
    } as any)!;
    expect(progress.spent).toBe(312);
    expect(progress.target).toBe(500);
    expect(progress.pct).toBeCloseTo(0.624, 3);
    // 10 of 27 days elapsed.
    expect(progress.elapsedPct).toBeCloseTo(10 / 27, 3);
  });

  it("has no pace to report without a bounded window", () => {
    expect(budgetProgress(summary(312, "2026-02-11"), { target: 500 } as any)!.elapsedPct).toBeNull();
  });

  it("says nothing without a usable target", () => {
    expect(budgetProgress(summary(312, "2026-02-11"), {} as any)).toBeNull();
    expect(budgetProgress(summary(312, "2026-02-11"), { target: 0 } as any)).toBeNull();
    expect(budgetProgress(null, { target: 500 } as any)).toBeNull();
  });
});
