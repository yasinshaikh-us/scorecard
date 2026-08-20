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

  it("shows a period-over-period delta when the question asked for one", async () => {
    await renderWithTheme(
      <QueryStats
        summary={summary({ sum: 300 })}
        outlier={null}
        comparison={{ sum: 200, count: 4, start: "2026-01-04", end: "2026-01-31", deltaPct: 0.5 }}
      />
    );
    const note = screen.getByTestId("query-stats-comparison");
    expect(note).toHaveTextContent(/↑ 50%/);
    expect(note).toHaveTextContent(/\$200\.00/);
  });

  it("marks a fall with a down arrow rather than a negative percentage", async () => {
    await renderWithTheme(
      <QueryStats
        summary={summary({ sum: 100 })}
        outlier={null}
        comparison={{ sum: 200, count: 4, start: "2026-01-04", end: "2026-01-31", deltaPct: -0.5 }}
      />
    );
    expect(screen.getByTestId("query-stats-comparison")).toHaveTextContent(/↓ 50%/);
  });

  it("says the previous period was empty instead of claiming an infinite rise", async () => {
    await renderWithTheme(
      <QueryStats
        summary={summary()}
        outlier={null}
        comparison={{ sum: 0, count: 0, start: "2026-01-04", end: "2026-01-31", deltaPct: null }}
      />
    );
    expect(screen.getByTestId("query-stats-comparison")).toHaveTextContent(/nothing in the previous/);
  });

  it("tracks a budget against the period's own pace", async () => {
    await renderWithTheme(
      <QueryStats
        summary={summary({ sum: 312 })}
        outlier={null}
        budget={{ spent: 312, target: 500, pct: 0.624, elapsedPct: 0.37 }}
      />
    );
    const note = screen.getByTestId("query-stats-budget");
    expect(note).toHaveTextContent(/\$312\.00 of \$500\.00/);
    expect(note).toHaveTextContent(/62%/);
    expect(note).toHaveTextContent(/ahead of pace \(37% through\)/);
  });

  it("says on track when spend is behind the pace", async () => {
    await renderWithTheme(
      <QueryStats summary={summary({ sum: 100 })} outlier={null} budget={{ spent: 100, target: 500, pct: 0.2, elapsedPct: 0.5 }} />
    );
    expect(screen.getByTestId("query-stats-budget")).toHaveTextContent(/on track \(50% through\)/);
  });

  it("omits every optional note when the question asked for none of them", async () => {
    await renderWithTheme(<QueryStats summary={summary()} outlier={null} />);
    expect(screen.queryByTestId("query-stats-comparison")).toBeNull();
    expect(screen.queryByTestId("query-stats-budget")).toBeNull();
    expect(screen.queryByTestId("query-stats-projection")).toBeNull();
  });

  it("carries the window's rate forward, hedged as a pace rather than a forecast", async () => {
    await renderWithTheme(
      <QueryStats
        summary={summary({ sum: 260 })}
        outlier={null}
        projection={{ projected: 780, through: "2026-08-11", windowEnd: "2026-08-31", elapsedPct: 1 / 3 }}
      />
    );
    const note = screen.getByTestId("query-stats-projection");
    expect(note).toHaveTextContent(/at this pace/);
    expect(note).toHaveTextContent(/\$780\.00/);
    expect(note).toHaveTextContent(/31 Aug 26/);
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
