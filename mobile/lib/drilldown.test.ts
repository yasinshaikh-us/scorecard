import { describe, it, expect } from "@jest/globals";
import { buildDrilldown } from "./drilldown";
import { buildChartData, fillDateBuckets, filterTransactions, resolveSpec } from "./logic";
import type { Transaction } from "./types";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    Id: 1,
    Date: "2026-07-22",
    Payee: "Chipotle",
    Category: "Food:Restaurants",
    Amount: -12.5,
    Account: "Checking",
    IsTransfer: false,
    Pending: false,
    ...overrides,
  };
}

const TODAY = "2026-09-08";

describe("buildDrilldown", () => {
  describe("payee", () => {
    it("asks for exactly that payee over the twelve months ending at the ledger's last date", () => {
      const { question, spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, TODAY);
      expect(question).toBe("Chipotle — last 12 months");
      expect(spec.title).toBe("All activity at Chipotle");
      expect(spec.payeeExact).toBe("Chipotle");
      expect(spec.categories).toBeNull();
      // The first of the month eleven months back: that month through
      // this one is twelve, where a day-anchored year would span
      // thirteen partial ones.
      expect(spec.dateStart).toBe("2025-10-01");
      expect(spec.dateEnd).toBeNull();
    });

    // Magnitudes, so both directions stack up the positive axis -- a
    // signed metric put every expense-only payee under a half-empty
    // chart with its month labels drawn over the bars.
    it("covers income as well as expenses, both above the axis", () => {
      const { spec } = buildDrilldown({ kind: "payee", value: "Acme Payroll" }, TODAY);
      expect(spec.type).toBe("all");
      expect(spec.metric).toBe("sum");
    });

    it("groups into monthly bars", () => {
      const { spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, TODAY);
      expect(spec.groupBy).toBe("month");
      expect(spec.chartType).toBe("bar");
    });
  });

  describe("category", () => {
    // The badge draws the top-level category and the palette colours by
    // it, so a tap on a "Food:Restaurants" row is a question about Food.
    it("widens a subcategory to its top level", () => {
      const { question, spec } = buildDrilldown({ kind: "category", value: "Food:Restaurants" }, TODAY);
      expect(question).toBe("Food — last 12 months");
      expect(spec.title).toBe("All Food activity");
      expect(spec.categories).toEqual(["Food"]);
      expect(spec.payeeExact).toBeNull();
    });

    it("leaves a top-level category alone", () => {
      const { spec } = buildDrilldown({ kind: "category", value: "Groceries" }, TODAY);
      expect(spec.categories).toEqual(["Groceries"]);
    });

    it("uses the same window, metric and grouping as a payee drilldown", () => {
      const { spec } = buildDrilldown({ kind: "category", value: "Food" }, TODAY);
      expect(spec.dateStart).toBe("2025-10-01");
      expect(spec.type).toBe("all");
      expect(spec.metric).toBe("sum");
      expect(spec.groupBy).toBe("month");
    });
  });

  // An empty ledger has no last date to count back from. A window dated
  // from "" would compare every row against a string that sorts below
  // every ISO date, which is the silent-empty-result trap specSchema.ts
  // exists to prevent -- so there is simply no lower bound.
  it("leaves the window open when the ledger has no dates yet", () => {
    const { spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, "");
    expect(spec.dateStart).toBeNull();
  });

  // The window a tap asked for, not the one the payee's billing happens
  // to cover. A sporadic merchant drew six or seven bars and read as an
  // answer about the last twelve months.
  describe("the twelve months are always all there", () => {
    const sparse = [
      tx({ Id: 1, Date: "2026-09-02", Amount: -20 }),
      tx({ Id: 2, Date: "2026-06-14", Amount: -30 }),
      tx({ Id: 3, Date: "2025-11-30", Amount: -40 }),
    ];

    function drilldownChart(rows: Transaction[]) {
      const { spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, TODAY);
      const filtered = filterTransactions(rows, spec);
      return fillDateBuckets(buildChartData(filtered, resolveSpec(filtered, spec)), spec, TODAY);
    }

    it("draws twelve consecutive monthly buckets from three transactions", () => {
      const data = drilldownChart(sparse);
      expect(data).toHaveLength(12);
      expect(data[0].key).toBe("2025-10");
      expect(data[11].key).toBe("2026-09");
      expect(data.map((d) => d.key)).toEqual([...new Set(data.map((d) => d.key))]);
    });

    it("gives the empty months a zero bucket rather than no bucket", () => {
      const byKey = Object.fromEntries(drilldownChart(sparse).map((d) => [d.key, d]));
      expect(byKey["2025-12"]).toMatchObject({ total: 0, sum: 0, count: 0 });
      expect(byKey["2026-06"]).toMatchObject({ total: 30, count: 1 });
      expect(byKey["2025-11"]).toMatchObject({ total: 40, count: 1 });
    });

    // resolveSpec re-groups a single-bucket answer to expose its shape,
    // which is the wrong instinct here: it would answer a twelve-month
    // question with a handful of days.
    it("keeps the monthly grouping when every row lands in one month", () => {
      const oneMonth = [tx({ Id: 1, Date: "2026-09-02" }), tx({ Id: 2, Date: "2026-09-20" })];
      const data = drilldownChart(oneMonth);
      expect(data).toHaveLength(12);
      expect(data[11].key).toBe("2026-09");
    });

    it("still draws the twelve months when the payee has nothing in any of them", () => {
      const data = drilldownChart([tx({ Id: 1, Payee: "Somewhere Else", Date: "2026-09-02" })]);
      expect(data).toHaveLength(12);
      expect(data.every((d) => d.count === 0)).toBe(true);
    });
  });

  describe("what the spec actually matches", () => {
    const rows = [
      tx({ Id: 1, Payee: "Chipotle", Date: "2026-07-22" }),
      // Same merchant, different capitalisation from the bank.
      tx({ Id: 2, Payee: "CHIPOTLE", Date: "2026-06-01" }),
      // A substring match would fold this in; an exact one must not.
      tx({ Id: 3, Payee: "Chipotle Catering", Date: "2026-06-02" }),
      // Older than the window.
      tx({ Id: 4, Payee: "Chipotle", Date: "2024-01-05" }),
      // A refund from the same merchant -- income, and still in scope.
      tx({ Id: 5, Payee: "Chipotle", Date: "2026-05-04", Amount: 12.5 }),
      tx({ Id: 6, Payee: "Safeway", Category: "Groceries", Date: "2026-07-01" }),
    ];

    it("matches one payee exactly, case-insensitively, inside the window", () => {
      const { spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, TODAY);
      expect(filterTransactions(rows, spec).map((r) => r.Id)).toEqual([1, 2, 5]);
    });

    it("matches every row in the category, whichever way the money moved", () => {
      const { spec } = buildDrilldown({ kind: "category", value: "Food:Restaurants" }, TODAY);
      expect(filterTransactions(rows, spec).map((r) => r.Id)).toEqual([1, 2, 3, 5]);
    });

    // The app-wide rule (see filterTransactions): an internal transfer is
    // one row on each side of the same movement, and counting both
    // double-counts it. A drilldown opts into nothing that changes that.
    it("still excludes internal transfers", () => {
      const withTransfer = [...rows, tx({ Id: 7, Payee: "Chipotle", Date: "2026-07-23", IsTransfer: true })];
      const { spec } = buildDrilldown({ kind: "payee", value: "Chipotle" }, TODAY);
      expect(filterTransactions(withTransfer, spec).map((r) => r.Id)).toEqual([1, 2, 5]);
    });
  });
});
