import { describe, it, expect } from "@jest/globals";
import { daysBefore, fmtDate, fmtMonth, fmtGroupKey, fmtMoney, fmtQuarter, isDateKey } from "./format";

describe("daysBefore", () => {
  it("subtracts N days from a date, crossing a month boundary", () => {
    expect(daysBefore("2026-04-03", 7)).toBe("2026-03-27");
  });
  it("crosses a year boundary", () => {
    expect(daysBefore("2026-01-02", 7)).toBe("2025-12-26");
  });
  it("computes the same result regardless of the runtime's local timezone (same UTC-anchored pattern as groupKeyOf's week grouping)", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const negativeOffset = daysBefore("2026-04-03", 7);
      process.env.TZ = "Asia/Kolkata";
      const positiveOffset = daysBefore("2026-04-03", 7);
      expect(positiveOffset).toBe(negativeOffset);
      expect(positiveOffset).toBe("2026-03-27");
    } finally {
      process.env.TZ = original;
    }
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
    expect(fmtDate(null as unknown as string)).toBe("");
    expect(fmtDate(undefined as unknown as string)).toBe("");
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

describe("isDateKey", () => {
  it("is true for day/week/month", () => {
    expect(isDateKey("day")).toBe(true);
    expect(isDateKey("week")).toBe(true);
    expect(isDateKey("month")).toBe(true);
  });
  it("is false for category/payee/account/transaction", () => {
    expect(isDateKey("category")).toBe(false);
    expect(isDateKey("payee")).toBe(false);
    expect(isDateKey("account")).toBe(false);
    expect(isDateKey("transaction")).toBe(false);
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


describe("fmtQuarter", () => {
  it("formats a quarter key as 'Qn YY'", () => {
    expect(fmtQuarter("2026-Q3")).toBe("Q3 26");
    expect(fmtQuarter("2020-Q1")).toBe("Q1 20");
  });
  it("returns malformed input unchanged", () => {
    expect(fmtQuarter("2026-Q9")).toBe("2026-Q9");
    expect(fmtQuarter("2026-07")).toBe("2026-07");
    expect(fmtQuarter(null as unknown as string)).toBe("");
  });
});

// quarter and year exist so a multi-year question has a bucket coarser
// than a month -- six years is ~78 monthly points but ~26 quarterly ones.
describe("quarter and year group keys", () => {
  it("counts both as date keys", () => {
    expect(isDateKey("quarter")).toBe(true);
    expect(isDateKey("year")).toBe(true);
    expect(isDateKey("payee")).toBe(false);
  });
  it("formats them through fmtGroupKey", () => {
    expect(fmtGroupKey("2026-Q3", "quarter")).toBe("Q3 26");
    expect(fmtGroupKey("2026", "year")).toBe("2026");
  });
});
