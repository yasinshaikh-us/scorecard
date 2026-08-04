import { describe, it, expect } from "vitest";
import {
  topCategory, computeDataMeta, fmtDate, fmtMonth, fmtGroupKey, fmtMoney,
  filterTransactions, groupKeyOf, buildChartData, cleanRows, parseQueryResponse,
} from "./logic.js";

const row = (Date, Payee, Category, Amount) => ({ Date, Payee, Category, Amount });

describe("topCategory", () => {
  it("splits Top:Sub on the first colon", () => {
    expect(topCategory("Home:Rent")).toBe("Home");
    expect(topCategory("Auto & Transport:Car Insurance")).toBe("Auto & Transport");
  });
  it("returns the whole string when there's no colon", () => {
    expect(topCategory("Groceries")).toBe("Groceries");
  });
  it("falls back to Uncategorized for null/undefined/empty", () => {
    expect(topCategory(null)).toBe("Uncategorized");
    expect(topCategory(undefined)).toBe("Uncategorized");
    expect(topCategory("")).toBe("Uncategorized");
  });
});

describe("computeDataMeta", () => {
  it("returns empty/blank defaults for an empty dataset", () => {
    expect(computeDataMeta([])).toEqual({ CATS: [], SUBCATS: [], MIN_DATE: "", MAX_DATE: "" });
  });

  it("computes MIN_DATE/MAX_DATE correctly regardless of row order (regression test for the Max-Rows truncation bug)", () => {
    // Mirrors the real bug: if a caller only fed the first N rows in
    // ascending-date order, MAX_DATE would silently look like the data
    // ends years before it actually does. This checks the pure computation
    // itself gets the true min/max from whatever rows it's given, in any order.
    const rows = [
      row("2022-06-01", "A", "Home:Rent", -100),
      row("2026-07-22", "B", "Groceries", -50),
      row("2020-03-02", "C", "Home:Mortgage", -5000),
      row("2024-01-15", "D", "Dining & Drinks:Restaurants", -20),
    ];
    const meta = computeDataMeta(rows);
    expect(meta.MIN_DATE).toBe("2020-03-02");
    expect(meta.MAX_DATE).toBe("2026-07-22");
  });

  it("dedupes top-level categories in first-seen order and sorts full subcategory strings", () => {
    const rows = [
      row("2024-01-01", "A", "Home:Rent", -1),
      row("2024-01-02", "B", "Groceries", -2),
      row("2024-01-03", "C", "Home:Mortgage", -3),
      row("2024-01-04", "D", "Home:Rent", -4),
    ];
    const meta = computeDataMeta(rows);
    expect(meta.CATS).toEqual(["Home", "Groceries"]);
    expect(meta.SUBCATS).toEqual(["Groceries", "Home:Mortgage", "Home:Rent"]);
  });

  it("crashes on a null Category if the caller skips cleanRows first (why api/query.js must call it)", () => {
    // computeDataMeta trusts its input is already clean; this documents
    // why api/query.js crashed with an unhandled "Cannot read
    // properties of null (reading 'trim')" before it started running
    // rows through cleanRows like the client already did.
    expect(() => computeDataMeta([row("2026-01-01", "A", null, -1)])).toThrow();
  });
});

describe("cleanRows", () => {
  it("drops rows missing a required field instead of letting them reach computeDataMeta broken", () => {
    const rows = [
      row("2026-01-01", "Good Payee", "Groceries", -10),
      row("2026-01-02", "No Category", null, -20),
      { Date: "2026-01-03", Payee: "No Amount", Category: "Home", Amount: null },
      { Date: "2026-01-04", Payee: "NaN Amount", Category: "Home", Amount: "not-a-number" },
      row(null, "No Date", "Home", -5),
      row("2026-01-05", null, "Home", -6),
    ];
    const out = cleanRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].Payee).toBe("Good Payee");
  });

  it("trims strings and coerces Amount to a number", () => {
    const out = cleanRows([{ Date: " 2026-01-01 ", Payee: " Chipotle ", Category: " Dining ", Amount: "-12.50" }]);
    expect(out).toEqual([{
      Date: "2026-01-01", Payee: "Chipotle", Category: "Dining", Amount: -12.5,
      Account: "Manual entry", IsTransfer: false,
    }]);
  });

  it("defaults Account to 'Manual entry' and IsTransfer to false when absent (rows fetched before either field existed)", () => {
    const out = cleanRows([row("2026-01-01", "Chipotle", "Dining", -12.5)]);
    expect(out[0].Account).toBe("Manual entry");
    expect(out[0].IsTransfer).toBe(false);
  });

  it("passes through a real Account label and coerces IsTransfer to a boolean", () => {
    const out = cleanRows([
      { Date: "2026-01-01", Payee: "Transfer", Category: "Transfer", Amount: -500, Account: " Chase Checking ••1234 ", IsTransfer: 1 },
    ]);
    expect(out[0].Account).toBe("Chase Checking ••1234");
    expect(out[0].IsTransfer).toBe(true);
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

  it("returns the parsed spec for a well-formed ledger query response", () => {
    const data = { content: [{ type: "text", text: '{"isLedgerQuery": true, "chartType": "bar"}' }] };
    expect(parseQueryResponse(true, data)).toEqual({ spec: { isLedgerQuery: true, chartType: "bar" } });
  });

  it("strips markdown code fences before parsing", () => {
    const data = { content: [{ type: "text", text: '```json\n{"isLedgerQuery": false}\n```' }] };
    expect(parseQueryResponse(true, data)).toEqual({ offTopic: true });
  });

  it("errors instead of throwing when there's no text content block (regression: this used to reach JSON.parse('') and blame a parse failure for what was really a missing/failed response)", () => {
    expect(parseQueryResponse(true, { content: [] })).toEqual({
      error: "Claude did not return a text response.",
    });
    expect(parseQueryResponse(true, {})).toEqual({
      error: "Claude did not return a text response.",
    });
  });

  it("errors instead of throwing when the text block isn't valid JSON", () => {
    const data = { content: [{ type: "text", text: "not json" }] };
    const result = parseQueryResponse(true, data);
    expect(result.error).toBeTruthy();
    expect(result.spec).toBeUndefined();
  });
});

describe("fmtDate", () => {
  it("formats a YYYY-MM-DD string as 'D Mon YY'", () => {
    expect(fmtDate("2026-07-22")).toBe("22 Jul 26");
    expect(fmtDate("2026-01-05")).toBe("5 Jan 26");
  });
  it("returns malformed input unchanged", () => {
    expect(fmtDate("not-a-date-x")).toBe("not-a-date-x");
    expect(fmtDate("2026/07/22")).toBe("2026/07/22");
  });
  it("returns empty string for null/undefined", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });
});

describe("fmtMonth", () => {
  it("formats a YYYY-MM string as 'Mon YY'", () => {
    expect(fmtMonth("2026-07")).toBe("Jul 26");
  });
  it("returns malformed input unchanged", () => {
    expect(fmtMonth("2026")).toBe("2026");
  });
});

describe("fmtGroupKey", () => {
  it("routes month keys through fmtMonth", () => {
    expect(fmtGroupKey("2026-07", "month")).toBe("Jul 26");
  });
  it("routes day/week keys through fmtDate", () => {
    expect(fmtGroupKey("2026-07-22", "day")).toBe("22 Jul 26");
    expect(fmtGroupKey("2026-07-19", "week")).toBe("19 Jul 26");
  });
  it("passes category/payee keys through unchanged", () => {
    expect(fmtGroupKey("Groceries", "category")).toBe("Groceries");
    expect(fmtGroupKey("Chipotle", "payee")).toBe("Chipotle");
  });
});

describe("fmtMoney", () => {
  it("formats positive amounts", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
  });
  it("formats negative amounts with a leading minus", () => {
    expect(fmtMoney(-42)).toBe("-$42.00");
  });
  it("formats zero without a sign", () => {
    expect(fmtMoney(0)).toBe("$0.00");
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

  it("categoryContains isolates a subcategory without matching sibling subcategories (the 'rent' vs 'mortgage' case)", () => {
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
    // Chase Mortgage (5712.04) is correctly excluded — over the $4,000 max.
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

    it("excludes IsTransfer rows by default, even for type 'all' (regression: multi-account transfers must not double-count as both an expense and income)", () => {
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
      expect(out).toEqual([]); // the one Savings row is a transfer, excluded by default
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
    expect(groupKeyOf({ groupBy: "account" }, row("2026-01-01", "Chipotle", "Dining", -1))).toBe("Manual entry");
  });
  it("groups by day (the raw date)", () => {
    expect(groupKeyOf({ groupBy: "day" }, row("2026-01-01", "X", "Home", -1))).toBe("2026-01-01");
  });
  it("groups by month (YYYY-MM)", () => {
    expect(groupKeyOf({ groupBy: "month" }, row("2026-01-15", "X", "Home", -1))).toBe("2026-01");
  });
  it("groups by week, rounding down to that week's Sunday", () => {
    // 2026-01-15 is a Thursday; that week's Sunday is 2026-01-11.
    expect(groupKeyOf({ groupBy: "week" }, row("2026-01-15", "X", "Home", -1))).toBe("2026-01-11");
  });
  it("computes the same week-start regardless of the runtime's local timezone (regression: this used to round-trip a locally-parsed Date through toISOString(), shifting the result back a day for positive-UTC-offset zones like Asia/Kolkata)", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles"; // UTC-7/-8: the old bug never shifted this direction
      const negativeOffset = groupKeyOf({ groupBy: "week" }, row("2026-01-15", "X", "Home", -1));
      process.env.TZ = "Asia/Kolkata"; // UTC+5:30: the old bug shifted the week-start back a day
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
    expect(out[0].total).toBe(5100); // Home:Rent (100) + Home:Mortgage (5000)
  });

  it("caps payee grouping to the top 10 by total when no limit is given", () => {
    const manyPayees = Array.from({ length: 15 }, (_, i) =>
      row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1))
    );
    const out = buildChartData(manyPayees, { groupBy: "payee" });
    expect(out.length).toBe(10);
    expect(out[0].key).toBe("Payee14"); // highest amount (-15) sorts first
  });

  it("respects an explicit limit for payee grouping instead of the default 10", () => {
    const manyPayees = Array.from({ length: 15 }, (_, i) =>
      row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1))
    );
    const out = buildChartData(manyPayees, { groupBy: "payee", limit: 3 });
    expect(out.length).toBe(3);
    expect(out.map((d) => d.key)).toEqual(["Payee14", "Payee13", "Payee12"]);
  });

  it("does not cap category/account groupings by default, but does when an explicit limit is given (regression: 'top 3 categories' previously always returned every category)", () => {
    const manyCategories = Array.from({ length: 15 }, (_, i) =>
      row("2026-01-01", "X", `Cat${i}:Sub`, -(i + 1))
    );
    expect(buildChartData(manyCategories, { groupBy: "category" }).length).toBe(15);
    const capped = buildChartData(manyCategories, { groupBy: "category", limit: 3 });
    expect(capped.length).toBe(3);
    expect(capped.map((d) => d.key)).toEqual(["Cat14", "Cat13", "Cat12"]);
  });

  // Regression coverage for "top 10 expenses in April 2023" rendering as a
  // payee-total bar chart (e.g. one "Chipotle" bar summing every Chipotle
  // visit that month) with an unrelated, unlimited, date-sorted list of
  // every matching transaction underneath -- not the 10 individual
  // largest transactions the question actually asked for.
  describe("groupBy 'transaction' (ranking individual transactions by size)", () => {
    it("ranks each transaction individually instead of summing same-payee transactions together", () => {
      const rows = [
        row("2026-01-05", "Chipotle", "Dining", -12),
        row("2026-01-10", "Chipotle", "Dining", -8),
        row("2026-01-15", "Rent Co", "Home:Rent", -2000),
      ];
      const out = buildChartData(rows, { groupBy: "transaction" });
      // Two separate Chipotle entries, not one summed "Chipotle" bar.
      expect(out.length).toBe(3);
      expect(out.map((d) => d.total)).toEqual([2000, 12, 8]);
    });

    it("defaults to the top 10 individual transactions when no limit is given", () => {
      const rows = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
      const out = buildChartData(rows, { groupBy: "transaction" });
      expect(out.length).toBe(10);
      expect(out[0].total).toBe(15);
    });

    it("respects an explicit limit", () => {
      const rows = Array.from({ length: 15 }, (_, i) => row("2026-01-01", `Payee${i}`, "Shopping", -(i + 1)));
      const out = buildChartData(rows, { groupBy: "transaction", limit: 5 });
      expect(out.length).toBe(5);
    });

    it("each entry carries the original row, so the list below the chart can show exactly this ranked set", () => {
      const target = row("2026-01-05", "Chipotle", "Dining", -12);
      const out = buildChartData([target], { groupBy: "transaction" });
      expect(out[0].row).toBe(target);
    });
  });
});
