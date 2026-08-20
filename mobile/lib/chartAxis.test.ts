import { describe, it, expect } from "@jest/globals";
import {
  barGeometry,
  contentWidth,
  fmtAxisCount,
  fmtAxisMoney,
  labelBudget,
  lineGeometry,
  niceScale,
  periodLabels,
  yAxisLabels,
} from "./chartAxis";

// A phone-sized card: the Ask card's inner width less the y-axis gutter.
const PLOT = 290;

describe("niceScale", () => {
  it("puts the gridlines on round money rather than on slices of the data max", () => {
    // The complaint case: 4 equal slices of 132.75 are 33.19/66.38/99.56.
    const scale = niceScale(132.75);
    expect(yAxisLabels(scale)).toEqual(["$0", "$50", "$100", "$150"]);
  });

  it("keeps the axis above the data but as tight as a round step allows", () => {
    for (const max of [7, 42, 132.75, 480, 1001, 8300, 41000]) {
      const scale = niceScale(max);
      expect(scale.max).toBeGreaterThanOrEqual(max);
      // Never more than double the data -- an axis with the bars in its
      // bottom half is the failure mode of rounding up too eagerly.
      expect(scale.max).toBeLessThan(max * 2);
      expect(Number((scale.step * scale.sections).toFixed(10))).toBe(scale.max);
    }
  });

  it("uses steps a person reads as landmarks", () => {
    expect(yAxisLabels(niceScale(480))).toEqual(["$0", "$100", "$200", "$300", "$400", "$500"]);
    expect(yAxisLabels(niceScale(4283))).toEqual(["$0", "$1k", "$2k", "$3k", "$4k", "$5k"]);
    expect(yAxisLabels(niceScale(96))).toEqual(["$0", "$25", "$50", "$75", "$100"]);
  });

  it("degrades to a unit axis for an all-zero series rather than dividing by it", () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 1, sections: 1 });
    expect(niceScale(NaN)).toEqual({ max: 1, step: 1, sections: 1 });
  });
});

describe("fmtAxisMoney", () => {
  it("compacts thousands and millions to fit the 35dp gutter", () => {
    expect(fmtAxisMoney(0)).toBe("$0");
    expect(fmtAxisMoney(250)).toBe("$250");
    expect(fmtAxisMoney(1000)).toBe("$1k");
    expect(fmtAxisMoney(2500)).toBe("$2.5k");
    expect(fmtAxisMoney(12000)).toBe("$12k");
    expect(fmtAxisMoney(1_200_000)).toBe("$1.2m");
  });

  it("does not eat an integer's own trailing zeros", () => {
    expect(fmtAxisMoney(100)).toBe("$100");
    expect(fmtAxisMoney(120)).toBe("$120");
  });

  it("keeps cents only for a sub-dollar step", () => {
    expect(fmtAxisMoney(0.25)).toBe("$0.25");
    expect(fmtAxisMoney(2.5)).toBe("$2.5");
    expect(fmtAxisMoney(-50)).toBe("-$50");
  });
});

describe("periodLabels", () => {
  const days = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => `2026-08-${String(from + i).padStart(2, "0")}`);

  it("labels a day axis with the day number, naming the month only where it changes", () => {
    const keys = ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"];
    expect(periodLabels(keys, "day", 6)).toEqual(["29 Aug '26", "30", "31", "1 Sep", "2"]);
  });

  it("names the year again when the series crosses one", () => {
    const keys = ["2026-12-30", "2026-12-31", "2027-01-01"];
    expect(periodLabels(keys, "day", 6)).toEqual(["30 Dec '26", "31", "1 Jan '27"]);
  });

  it("thins a long series to the label budget, always naming the last period", () => {
    const labels = periodLabels(days(31), "day", 6);
    expect(labels).toHaveLength(31);
    const shown = labels.filter((l) => l !== "");
    expect(shown.length).toBeLessThanOrEqual(6);
    expect(labels[labels.length - 1]).not.toBe("");
    // The first label a reader meets carries month and year, wherever
    // thinning happened to place it.
    expect(shown[0]).toMatch(/Aug '26$/);
  });

  it("labels a week as the span of days it covers", () => {
    // Week keys are the Sunday that starts the week (logic.ts groupKeyOf).
    expect(periodLabels(["2026-08-02", "2026-08-09"], "week", 6)).toEqual(["2–8 Aug '26", "9–15"]);
  });

  it("labels a month axis with the month, and the year only where it changes", () => {
    const keys = ["2026-11", "2026-12", "2027-01"];
    expect(periodLabels(keys, "month", 6)).toEqual(["Nov '26", "Dec", "Jan '27"]);
  });

  it("leaves a non-date grouping's labels alone -- there is no period to compress", () => {
    expect(periodLabels(["Checking", "Savings"], "account", 6)).toEqual(["Checking", "Savings"]);
  });
});

describe("labelBudget", () => {
  it("scales with the space and stays within a readable band", () => {
    expect(labelBudget(290)).toBe(6);
    expect(labelBudget(60)).toBe(3);
    expect(labelBudget(2000)).toBe(7);
  });
});

// The whole point: whatever the group count, what gets drawn is no wider
// than the card. gifted-charts makes its plot scrollable the moment its
// content is wider than the `width` prop, which is what made long date
// ranges need swiping.
describe("barGeometry", () => {
  const counts = [1, 2, 3, 5, 7, 12, 31, 90, 366];

  it("never lays out a series wider than the plot", () => {
    for (const n of counts) {
      expect(contentWidth(barGeometry(PLOT, n), n)).toBeLessThanOrEqual(PLOT);
    }
  });

  it("uses the full plot rather than leaving the right-hand side empty", () => {
    for (const n of counts) {
      expect(contentWidth(barGeometry(PLOT, n), n)).toBeGreaterThan(PLOT * 0.95);
    }
  });

  it("keeps bars visible and gapped at every count", () => {
    for (const n of counts) {
      const g = barGeometry(PLOT, n);
      expect(g.barWidth).toBeGreaterThan(0);
      expect(g.barWidth).toBeLessThanOrEqual(22);
      expect(g.spacing).toBeGreaterThanOrEqual(0);
      // The last bar's right edge, which is what actually gets clipped.
      expect(g.initialSpacing + n * g.barWidth + (n - 1) * g.spacing).toBeLessThanOrEqual(PLOT);
    }
  });

  it("centres a short series instead of crowding it against the axis", () => {
    const g = barGeometry(PLOT, 3);
    expect(g.barWidth).toBe(22);
    // Equal air either side: initialSpacing on the left, endSpacing twice
    // on the right, which is how the library spends them.
    expect(Math.abs(g.initialSpacing - 2 * g.endSpacing)).toBeLessThanOrEqual(0.02);
  });

  it("adapts to a narrower card", () => {
    for (const width of [140, 200, 290, 340]) {
      expect(contentWidth(barGeometry(width, 31), 31)).toBeLessThanOrEqual(width);
    }
  });
});

describe("lineGeometry", () => {
  const counts = [1, 2, 5, 30, 60, 200];

  it("never lays out a series wider than the plot", () => {
    for (const n of counts) {
      expect(contentWidth(lineGeometry(PLOT, n), n)).toBeLessThanOrEqual(PLOT);
    }
  });

  it("keeps the last point inside the plot, with matching air either side", () => {
    for (const n of [2, 5, 30, 60]) {
      const g = lineGeometry(PLOT, n);
      expect(g.initialSpacing + (n - 1) * g.spacing).toBeLessThan(PLOT);
      expect(Math.abs(g.initialSpacing - 2 * g.endSpacing)).toBeLessThanOrEqual(0.02);
    }
  });

  it("uses most of the plot once there are enough points to fill it", () => {
    const g = lineGeometry(PLOT, 30);
    expect(g.initialSpacing + 29 * g.spacing).toBeGreaterThan(PLOT * 0.9);
  });
});


// A count axis is a tally: "2.5 transactions" is not a gridline, and the
// dollar sign would be a lie.
describe("count axis", () => {
  it("formats counts as whole numbers, compacting past a thousand", () => {
    expect(fmtAxisCount(0)).toBe("0");
    expect(fmtAxisCount(7)).toBe("7");
    expect(fmtAxisCount(1200)).toBe("1.2k");
  });

  it("keeps every gridline a whole number", () => {
    for (const max of [1, 3, 7, 12, 45, 611]) {
      const scale = niceScale(max, true);
      expect(scale.max).toBeGreaterThanOrEqual(max);
      expect(Number.isInteger(scale.step)).toBe(true);
      expect(scale.step).toBeGreaterThanOrEqual(1);
      for (const label of yAxisLabels(scale, fmtAxisCount)) expect(label).not.toContain(".");
    }
  });

  it("still allows fractional money steps when not counting", () => {
    expect(yAxisLabels(niceScale(9))).toEqual(["$0", "$2.5", "$5", "$7.5", "$10"]);
  });

  it("labels a count scale without currency", () => {
    expect(yAxisLabels(niceScale(12, true), fmtAxisCount)).toEqual(["0", "5", "10", "15"]);
  });
});
