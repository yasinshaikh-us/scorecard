import { describe, it, expect } from "@jest/globals";
import { buildDrilldown } from "./drilldown";
import { filterTransactions } from "./logic";
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
      expect(spec.dateStart).toBe("2025-09-08");
      expect(spec.dateEnd).toBeNull();
    });

    // Both directions and a signed metric: a payee can pay you (an
    // employer, a refund), and a chart summing magnitudes would draw that
    // refund as more spending.
    it("covers income as well as expenses", () => {
      const { spec } = buildDrilldown({ kind: "payee", value: "Acme Payroll" }, TODAY);
      expect(spec.type).toBe("all");
      expect(spec.metric).toBe("net");
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
      expect(spec.dateStart).toBe("2025-09-08");
      expect(spec.type).toBe("all");
      expect(spec.metric).toBe("net");
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
