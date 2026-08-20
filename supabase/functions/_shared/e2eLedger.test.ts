import { describe, it, expect } from "vitest";
import { buildE2eLedger, E2E_SOURCE } from "./e2eLedger.ts";

// This fixture is written to a real shared database before every Stage 2
// run, and the specs assert against what it produces. Each property below
// is one of those specs' premises -- when one stops holding, the failure
// should be here, in a second, rather than fourteen minutes into a Detox
// run against an emulator.
const TODAY = new Date("2026-08-20T00:00:00Z");
const ledger = buildE2eLedger(TODAY);

describe("the Stage 2 seed ledger", () => {
  it("marks every row so the cleanup can only ever match its own", () => {
    for (const row of ledger) expect(row.source).toBe(E2E_SOURCE);
    expect(E2E_SOURCE).not.toBe("plaid");
    expect(E2E_SOURCE).not.toBe("manual");
  });

  it("clears the card's 200-row cap inside the last twelve months", () => {
    const twelveMonthsAgo = "2025-08-20";
    const recent = ledger.filter((r) => r.date >= twelveMonthsAgo);
    expect(recent.length).toBeGreaterThan(200);
  });

  it("stays inside the window the questions ask about", () => {
    expect(ledger[0].date >= "2025-08-01").toBe(true);
    expect(ledger[ledger.length - 1].date <= "2026-08-20").toBe(true);
  });

  it("gives the merchant question something to chart", () => {
    const chipotle = ledger.filter((r) => r.payee === "Chipotle");
    expect(chipotle.length).toBeGreaterThanOrEqual(50);
    // Spread across months, not piled on one day.
    expect(new Set(chipotle.map((r) => r.date.slice(0, 7))).size).toBeGreaterThan(6);
  });

  it("gives recurrence detection real cadences to find", () => {
    for (const payee of ["Netflix", "T Mobile"]) {
      const charges = ledger.filter((r) => r.payee === payee);
      expect(charges.length).toBeGreaterThanOrEqual(12);
      // One stable amount, which is what separates a subscription from a
      // merchant visited monthly.
      expect(new Set(charges.map((r) => r.amount)).size).toBe(1);
    }
  });

  it("has both signs, so a cashflow question is not all one way", () => {
    expect(ledger.some((r) => r.amount > 0)).toBe(true);
    expect(ledger.some((r) => r.amount < 0)).toBe(true);
  });

  it("carries one purchase big enough to trip the outlier callout", () => {
    const biggest = Math.max(...ledger.map((r) => Math.abs(r.amount)));
    const monthOfBiggest = ledger.find((r) => Math.abs(r.amount) === biggest)!.date.slice(0, 7);
    const thatMonth = ledger.filter((r) => r.date.startsWith(monthOfBiggest) && r.amount < 0);
    const monthTotal = thatMonth.reduce((acc, r) => acc + Math.abs(r.amount), 0);
    expect(biggest / monthTotal).toBeGreaterThan(0.4);
  });

  it("spans several categories, so a breakdown has more than one slice", () => {
    expect(new Set(ledger.map((r) => r.category.split(":")[0])).size).toBeGreaterThanOrEqual(5);
  });

  it("is deterministic apart from the day it is generated on", () => {
    expect(buildE2eLedger(TODAY)).toEqual(ledger);
  });
});
