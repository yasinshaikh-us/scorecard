import { describe, it, expect } from "@jest/globals";
import { buildTestLedger, LEDGER_END, LEDGER_START } from "./testLedger";
import {
  buildChartData,
  buildSeriesData,
  filterTransactions,
  findOutlier,
  forecastBuckets,
  granularityForSpan,
  recurringPayees,
  resolveSpec,
  spanDays,
  summarize,
} from "./logic";
import { normalizeSpec } from "./specSchema";
import { barGeometry, contentWidth, labelBudget, periodLabels } from "./chartAxis";

// Everything else in this suite asserts arithmetic on two to four rows.
// This file asserts SHAPE, on a ledger the size of a real one: six and a
// half years, thousands of rows, nineteen-odd categories, four
// subscriptions, and two purchases big enough to flatten every chart
// they touch. Those are the conditions the granularity ladder, the
// capping, the re-grouping and the geometry were all written for, and
// none of them were exercised at that size before.
const LEDGER = buildTestLedger();
// The plot inside the Ask card on a phone, once the y-axis gutter has
// its share.
const PLOT = 290;

describe("a full-size ledger", () => {
  it("is the size and span it claims to be", () => {
    // The real ledger this mirrors holds ~6,000 rows over the same span.
    expect(LEDGER.length).toBeGreaterThan(5000);
    expect(LEDGER[0].Date).toBe(LEDGER_START);
    expect(LEDGER[LEDGER.length - 1].Date).toBe(LEDGER_END);
    expect(new Set(LEDGER.map((r) => r.Category.split(":")[0])).size).toBeGreaterThanOrEqual(10);
  });

  it("is deterministic, so a failure here reproduces", () => {
    expect(buildTestLedger().length).toBe(LEDGER.length);
    expect(buildTestLedger({ seed: 1 }).length).not.toBe(0);
  });
});

describe("granularity at real spans", () => {
  it("resolves six and a half years to quarters rather than eighty months", () => {
    expect(granularityForSpan(spanDays(LEDGER))).toBe("quarter");
  });

  it("still gives a month bucket per month when the question asks for months", () => {
    const data = buildChartData(LEDGER, { groupBy: "month" } as any);
    // 2020-03 through 2026-08 inclusive.
    expect(data).toHaveLength(78);
    expect(data[0].key).toBe("2020-03");
    expect(data[data.length - 1].key).toBe("2026-08");
    // Chronological, not by size -- a trend read backwards is not a trend.
    const keys = data.map((d) => d.key);
    expect(keys).toEqual(keys.slice().sort());
  });

  it("fits every one of those buckets inside the card", () => {
    for (const groupBy of ["quarter", "month", "week", "day"] as const) {
      // Through resolveSpec, as the card does: a grouping too fine to
      // draw is coarsened there, not squeezed by the geometry.
      const resolved = resolveSpec(LEDGER, { groupBy, chartType: "bar" } as any)!;
      const data = buildChartData(LEDGER, resolved);
      const geometry = barGeometry(PLOT, data.length);
      expect(contentWidth(geometry, data.length)).toBeLessThanOrEqual(PLOT);
      expect(geometry.barWidth).toBeGreaterThan(0);
    }
  });

  it("thins six years of labels down to what the card can hold", () => {
    const data = buildChartData(LEDGER, { groupBy: "month" } as any);
    const labels = periodLabels(data.map((d) => d.key), "month", labelBudget(PLOT));
    expect(labels).toHaveLength(78);
    expect(labels.filter(Boolean).length).toBeLessThanOrEqual(labelBudget(PLOT));
    // The most recent bucket is always named.
    expect(labels[labels.length - 1]).toBeTruthy();
  });
});

describe("a grouping too fine to draw", () => {
  // Nothing stops the model asking for a daily chart of six years: the
  // rules point at a coarser bucket, but rules are guidance. 2,300 bars
  // in a 290dp plot is not a chart, and with scrolling off it is data
  // that simply isn't on screen.
  it("coarsens a daily six-year grouping until the buckets can be drawn", () => {
    const spec = { groupBy: "day", chartType: "bar" } as any;
    const daily = new Set(LEDGER.map((r) => r.Date));
    expect(daily.size).toBeGreaterThan(1500);

    // Month, not quarter: the ladder stops at the FINEST bucket that
    // fits, which respects a question that asked for detail rather than
    // coarsening all the way to the span's default granularity.
    const resolved = resolveSpec(LEDGER, spec)!;
    expect(resolved.groupBy).toBe("month");
    expect(resolved.chartType).toBe("line");

    const data = buildChartData(LEDGER, resolved);
    expect(data.length).toBeLessThanOrEqual(120);
    expect(contentWidth(barGeometry(PLOT, data.length), data.length)).toBeLessThanOrEqual(PLOT);
  });

  it("takes only one step when one step is enough", () => {
    const oneYear = filterTransactions(LEDGER, { dateStart: "2025-08-20", dateEnd: "2026-08-19" } as any);
    const resolved = resolveSpec(oneYear, { groupBy: "day", chartType: "bar" } as any)!;
    expect(resolved.groupBy).toBe("week");
  });

  it("leaves a grouping that already fits alone", () => {
    const spec = { groupBy: "month", chartType: "line" } as any;
    expect(resolveSpec(LEDGER, spec)).toBe(spec);
  });
});

describe("a single-merchant question at scale", () => {
  const spec = normalizeSpec({ groupBy: "category", chartType: "bar", payeeContains: "Chipotle" }).spec;
  const rows = filterTransactions(LEDGER, spec);

  it("matches hundreds of rows across the whole ledger", () => {
    expect(rows.length).toBeGreaterThan(200);
  });

  it("re-groups over time instead of drawing one bar for six years", () => {
    const resolved = resolveSpec(rows, spec)!;
    expect(resolved.groupBy).toBe("quarter");
    expect(resolved.chartType).toBe("line");
    const data = buildChartData(rows, resolved);
    expect(data.length).toBeGreaterThan(20);
    expect(contentWidth(barGeometry(PLOT, data.length), data.length)).toBeLessThanOrEqual(PLOT);
  });

  it("reports a total that matches the rows it drew", () => {
    const s = summarize(rows)!;
    const byHand = rows.reduce((acc, r) => acc + Math.abs(r.Amount), 0);
    expect(s.sum).toBeCloseTo(byHand, 6);
    expect(s.count).toBe(rows.length);
  });
});

describe("capping at real cardinality", () => {
  it("caps a whole-ledger pie at six slices and keeps the rest reachable", () => {
    // Through the filter first, the way the card does it -- transfers are
    // excluded by default, so a total computed any other way disagrees.
    const spec = { groupBy: "category", chartType: "pie" } as any;
    const data = buildChartData(filterTransactions(LEDGER, spec), spec);
    expect(data).toHaveLength(6);
    expect(data[5].key).toBe("Other");
    expect(data[5].keys!.length).toBeGreaterThan(2);
    // Nothing is lost: the slices still add up to the whole.
    const total = filterTransactions(LEDGER, spec).reduce((acc, r) => acc + Math.abs(r.Amount), 0);
    expect(data.reduce((acc, d) => acc + d.sum, 0)).toBeCloseTo(total, 4);
  });

  it("caps a monthly split by category to six bands with aligned values", () => {
    const spec = { groupBy: "month", seriesBy: "category", chartType: "bar" } as any;
    const series = buildSeriesData(filterTransactions(LEDGER, spec), spec)!;
    expect(series.buckets).toHaveLength(78);
    expect(series.series.length).toBeLessThanOrEqual(6);
    expect(series.series[series.series.length - 1].name).toBe("Other");
    for (const s of series.series) expect(s.values).toHaveLength(series.buckets.length);
  });

  it("caps a merchant ranking to ten without dropping the biggest", () => {
    const data = buildChartData(LEDGER, { groupBy: "payee" } as any);
    expect(data).toHaveLength(10);
    expect(data[0].total).toBeGreaterThanOrEqual(data[9].total);
  });
});

describe("recurrence among thousands of irregular visits", () => {
  const found = recurringPayees(LEDGER);
  const names = found.map((r) => r.payee);

  it("finds the subscriptions", () => {
    for (const payee of ["Netflix", "Amazon Prime", "T Mobile", "Comcast"]) {
      expect(names).toContain(payee);
    }
  });

  it("finds the fixed bills too, since that is what they are", () => {
    expect(names).toContain("Chase Mortgage");
    expect(names).toContain("Amli");
  });

  it("does not mistake a heavily-visited restaurant for a subscription", () => {
    for (const payee of ["Panda Express", "Chipotle", "Starbucks", "Amazon"]) {
      expect(names).not.toContain(payee);
    }
  });

  it("ranks by what they actually cost per month", () => {
    expect(found[0].payee).toBe("Chase Mortgage");
    const perMonth = found.map((r) => r.perMonth);
    expect(perMonth).toEqual(perMonth.slice().sort((a, b) => b - a));
  });
});

describe("outliers in a real distribution", () => {
  it("names the single purchase that dominates its month", () => {
    // type "expense", because that is what a spending question resolves
    // to: over an unfiltered month, salary is legitimately the biggest
    // line and the callout would be about income.
    const july = filterTransactions(LEDGER, {
      type: "expense",
      dateStart: "2025-07-01",
      dateEnd: "2025-07-31",
    } as any);
    const outlier = findOutlier(july)!;
    expect(outlier.payee).toBe("Bitcoin");
    expect(outlier.share).toBeGreaterThan(0.9);
  });

  it("says nothing about an ordinary month", () => {
    // Dining in one month: dozens of small, similar amounts, which is
    // what "no outlier" actually looks like.
    const ordinary = filterTransactions(LEDGER, {
      type: "expense",
      categories: ["Dining"],
      dateStart: "2024-04-01",
      dateEnd: "2024-04-30",
    } as any);
    expect(ordinary.length).toBeGreaterThan(20);
    expect(findOutlier(ordinary)).toBeNull();
  });

  it("lets a spending trend exclude the category that distorts it", () => {
    const withInvestments = summarize(filterTransactions(LEDGER, { type: "expense" } as any))!;
    const without = summarize(
      filterTransactions(LEDGER, { type: "expense", excludeCategories: ["Investments"] } as any)
    )!;
    expect(withInvestments.sum - without.sum).toBeCloseTo(270000, 4);
  });
});

describe("projection at scale", () => {
  it("extends the monthly chart and leaves the real buckets untouched", () => {
    const actual = buildChartData(LEDGER, { groupBy: "month" } as any);
    const projected = forecastBuckets(actual, { groupBy: "month", forecast: true } as any, LEDGER_END);
    expect(projected).toHaveLength(actual.length + 3);
    expect(projected.slice(0, actual.length)).toEqual(actual);
    expect(projected.slice(actual.length).every((d) => d.projected && d.count === 0)).toBe(true);
  });
});
