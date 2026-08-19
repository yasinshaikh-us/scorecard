import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import Chart from "./Chart";
import type { ChartDatum, QuerySpec } from "../lib/logic";

// Chart.test.tsx mocks react-native-gifted-charts, so it proves what props
// the component passes and nothing about what the library does with them.
// This file deliberately renders the real one: the axis and geometry props
// added for the "fits in the card" work are the library's own arithmetic
// inputs, and a fractional barWidth or a yAxisLabelTexts array of the
// wrong length fails inside it, where a mock would never notice.

const days = (n: number, total = (i: number) => 20 + i): ChartDatum[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `2026-08-${String(i + 1).padStart(2, "0")}`,
    total: total(i),
    count: 1,
  }));

// Flattens the style arrays (which carry `false` entries for the
// conditional pieces) down to the one value being asserted on.
function styleValue(style: any, key: string): number | undefined {
  const parts = ([] as any[]).concat(style || []).filter(Boolean);
  let found: number | undefined;
  for (const part of parts) if (part && part[key] !== undefined) found = part[key];
  return found;
}

// RNTL 14 dropped the UNSAFE_*ByType queries, so the rendered tree is
// walked directly. A ScrollView is an "RCTScrollView" host node once
// rendered.
function scrollViews(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  const children = ([] as any[]).concat(node.children || []).flatMap(scrollViews);
  return node.type === "RCTScrollView" ? [node, ...children] : children;
}

describe("Chart (real gifted-charts)", () => {
  // The library schedules a label fade-in with setTimeout even at
  // isAnimated={false}. Left on real timers it fires after the test has
  // finished and tears the Jest worker down mid-callback; on fake timers
  // it is simply discarded with the rest of the queue.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders a long day series without a horizontally scrollable plot", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "day" };
    const view = await renderWithTheme(
      <Chart data={days(45)} spec={spec} CATS={[]} selectedKey={null} onSelect={jest.fn()} />
    );

    // gifted-charts always wraps the plot in a ScrollView; what matters is
    // that scrolling is off, so a long series can't hide data off-screen.
    const scrollables = scrollViews(view.toJSON());
    expect(scrollables.length).toBeGreaterThan(0);
    for (const s of scrollables) {
      expect(s.props.scrollEnabled).toBe(false);
      // The real test of "it fits": the library's own content box is no
      // wider than the box it is drawn in, so nothing is off the right
      // edge waiting to be swiped to (or, with scrolling off, clipped).
      const content = styleValue(s.props.contentContainerStyle, "width");
      const box = styleValue(s.props.style, "width");
      expect(content).toBeDefined();
      expect(box).toBeDefined();
      expect(content as number).toBeLessThanOrEqual(box as number);
    }
  });

  it("draws the round-money gridlines it was given", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "day" };
    const data = days(5, (i) => (i === 0 ? 132.75 : 20));
    await renderWithTheme(<Chart data={data} spec={spec} CATS={[]} selectedKey={null} onSelect={jest.fn()} />);

    for (const label of ["$0", "$50", "$100", "$150"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText("$33.19")).toBeNull();
  });

  it("draws period x-axis labels, not a full date per bar", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "day" };
    const data = [
      { key: "2026-08-30", total: 10, count: 1 },
      { key: "2026-08-31", total: 20, count: 1 },
      { key: "2026-09-01", total: 30, count: 1 },
    ];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={[]} selectedKey={null} onSelect={jest.fn()} />);

    expect(screen.getByText("30 Aug '26")).toBeTruthy();
    expect(screen.getByText("1 Sep")).toBeTruthy();
    expect(screen.queryByText("31 Aug 26")).toBeNull();
  });

  it("renders a line chart over a long series too", async () => {
    const spec: QuerySpec = { chartType: "line", groupBy: "day" };
    const view = await renderWithTheme(
      <Chart data={days(60)} spec={spec} CATS={[]} selectedKey={null} onSelect={jest.fn()} />
    );

    expect(screen.getByText("$0")).toBeTruthy();
    const scrollables = scrollViews(view.toJSON());
    expect(scrollables.length).toBeGreaterThan(0);
    for (const s of scrollables) {
      expect(s.props.scrollEnabled).toBe(false);
      const content = styleValue(s.props.contentContainerStyle, "width");
      const box = styleValue(s.props.style, "width");
      expect(content as number).toBeLessThanOrEqual(box as number);
    }
  });
});
