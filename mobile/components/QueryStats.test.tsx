import { describe, it, expect } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import QueryStats, { fmtSpan } from "./QueryStats";
import type { QuerySummary } from "../lib/logic";

const summary = (overrides: Partial<QuerySummary> = {}): QuerySummary => ({
  sum: 13197.01,
  count: 611,
  average: 21.6,
  perMonth: 169.1,
  start: "2020-03-02",
  end: "2026-08-19",
  months: 78,
  ...overrides,
});

// The card used to answer "how much did I spend at Chipotle?" with a bar
// and nothing else -- no total, no count, and no hint that the number
// covered six years.
describe("QueryStats", () => {
  it("leads with the total, the count and the average", async () => {
    await renderWithTheme(<QueryStats summary={summary()} outlier={null} />);

    expect(screen.getByTestId("query-stat-total")).toHaveTextContent("$13,197.01");
    expect(screen.getByTestId("query-stat-count")).toHaveTextContent("611");
    expect(screen.getByTestId("query-stat-average")).toHaveTextContent("$21.60");
  });

  it("names the span the figures cover", async () => {
    await renderWithTheme(<QueryStats summary={summary()} outlier={null} />);
    expect(screen.getByText("2 Mar 20 – 19 Aug 26 · 6.5 yrs")).toBeTruthy();
  });

  it("says nothing about outliers when the spread is even", async () => {
    await renderWithTheme(<QueryStats summary={summary()} outlier={null} />);
    expect(screen.queryByTestId("query-stats-outlier")).toBeNull();
  });

  it("calls out a single transaction that is most of the total", async () => {
    await renderWithTheme(
      <QueryStats summary={summary()} outlier={{ share: 0.62, rows: 1, payee: "Bitcoin", amount: 170000 }} />
    );
    // Regexes, not strings: RNTL's toHaveTextContent matches a bare
    // string against the WHOLE content, so a substring assertion has to
    // be written as a pattern.
    const note = screen.getByTestId("query-stats-outlier");
    expect(note).toHaveTextContent(/1 transaction is/);
    expect(note).toHaveTextContent(/62%/);
    expect(note).toHaveTextContent(/Bitcoin/);
    expect(note).toHaveTextContent(/\$170,000\.00/);
  });

  it("pluralizes a multi-row outlier", async () => {
    await renderWithTheme(
      <QueryStats summary={summary()} outlier={{ share: 0.7, rows: 3, payee: "Bitcoin", amount: 200000 }} />
    );
    expect(screen.getByTestId("query-stats-outlier")).toHaveTextContent(/3 transactions are/);
  });

  it("uses the singular label for a one-transaction result", async () => {
    await renderWithTheme(<QueryStats summary={summary({ count: 1 })} outlier={null} />);
    expect(screen.getByText("transaction")).toBeTruthy();
  });
});

describe("fmtSpan", () => {
  it("reads short spans in months and long ones in years", () => {
    expect(fmtSpan(summary({ start: "2026-01-01", end: "2026-08-19", months: 7.6 }))).toBe(
      "1 Jan 26 – 19 Aug 26 · 8 mo"
    );
    expect(fmtSpan(summary({ months: 78 }))).toBe("2 Mar 20 – 19 Aug 26 · 6.5 yrs");
    expect(fmtSpan(summary({ start: "2010-01-01", months: 200 }))).toBe("1 Jan 10 – 19 Aug 26 · 17 yrs");
  });

  it("never reports a zero-length window", () => {
    expect(fmtSpan(summary({ start: "2026-08-19", end: "2026-08-19", months: 1 }))).toContain("1 mo");
  });
});
