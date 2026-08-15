import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import { lightColors } from "../lib/theme";
import Chart from "./Chart";
import type { ChartDatum, QuerySpec } from "../lib/logic";

const mockBarChart: any = jest.fn((_props: any) => null);
const mockLineChart: any = jest.fn((_props: any) => null);
const mockPieChart: any = jest.fn((_props: any) => null);
jest.mock("react-native-gifted-charts", () => ({
  BarChart: (props: any) => mockBarChart(props),
  LineChart: (props: any) => mockLineChart(props),
  PieChart: (props: any) => mockPieChart(props),
}));

const CATS = ["Groceries", "Dining"];

function datum(overrides: Partial<ChartDatum> = {}): ChartDatum {
  return { key: "Groceries", total: 42, count: 3, ...overrides };
}

// Chart.tsx picks bar/pie/line and, for bar, horizontal-vs-vertical layout
// and per-category coloring -- all pure prop-shaping around
// react-native-gifted-charts, none of it covered anywhere in Stage 1 (see
// mobile/README.md's "Not yet covered" note).
describe("Chart", () => {
  beforeEach(() => {
    mockBarChart.mockClear();
    mockLineChart.mockClear();
    mockPieChart.mockClear();
  });

  it("renders nothing when there's no data", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    await renderWithTheme(<Chart data={[]} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
    expect(mockBarChart).not.toHaveBeenCalled();
  });

  it("renders a PieChart for chartType 'pie', coloring by category", async () => {
    const spec: QuerySpec = { chartType: "pie", groupBy: "category" };
    const data = [datum({ key: "Groceries" }), datum({ key: "Dining", total: 10 })];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={CATS} selectedKey="Groceries" onSelect={jest.fn()} />);

    expect(mockPieChart).toHaveBeenCalledTimes(1);
    const props = mockPieChart.mock.calls[0][0];
    expect(props.data).toHaveLength(2);
    expect(props.data[0].value).toBe(42);
    expect(props.data[0].color).toBeDefined();
    // The selected slice gets a stroke; the other doesn't.
    expect(props.data[0].strokeWidth).toBe(2);
    expect(props.data[1].strokeWidth).toBe(0);
  });

  it("PieChart selection calls onSelect with that slice's key", async () => {
    const spec: QuerySpec = { chartType: "pie", groupBy: "category" };
    const onSelect = jest.fn();
    await renderWithTheme(<Chart data={[datum({ key: "Groceries" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={onSelect} />);
    mockPieChart.mock.calls[0][0].data[0].onPress();
    expect(onSelect).toHaveBeenCalledWith("Groceries");
  });

  it("renders a LineChart for chartType 'line', with formatted labels", async () => {
    const spec: QuerySpec = { chartType: "line", groupBy: "month" };
    const data = [datum({ key: "2026-01" }), datum({ key: "2026-02" })];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />);

    expect(mockLineChart).toHaveBeenCalledTimes(1);
    const props = mockLineChart.mock.calls[0][0];
    expect(props.data).toHaveLength(2);
    expect(typeof props.data[0].label).toBe("string");
  });

  // A category axis is labelled with the category's own icon rather than
  // its name -- names are what made this axis width-bound. So there is no
  // text label at all; the identity lives in labelComponent, and in the
  // accessibility label that names the category for a screen reader.
  it("labels a category BarChart with per-category icons, not names", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    await renderWithTheme(
      <Chart data={[datum({ key: "Groceries" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />
    );

    const props = mockBarChart.mock.calls[0][0];
    // Not passed at all any more: only vertical charts reach the library,
    // so there is no orientation left to switch on.
    expect(props.horizontal).toBeUndefined();
    expect(props.data[0].label).toBeUndefined();
    expect(props.data[0].frontColor).toBeDefined();

    // Inspected as an element rather than rendered: gifted-charts calls
    // labelComponent itself, so what matters is the element this returns.
    const label: any = props.data[0].labelComponent();
    expect(label.props.testID).toBe("chart-axis-icon-Groceries");
    expect(label.props.accessibilityLabel).toBe("Groceries");
  });

  // Non-category groupings have no icon to fall back on, so those keep
  // their text labels.
  it("keeps text labels for a non-category vertical grouping", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "month" };
    await renderWithTheme(
      <Chart data={[datum({ key: "2026-07" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />
    );

    const props = mockBarChart.mock.calls[0][0];
    expect(typeof props.data[0].label).toBe("string");
    expect(props.data[0].labelComponent).toBeUndefined();
  });

  // Rankings deliberately do NOT go through gifted-charts. Its `horizontal`
  // mode rotates the container, React Native excludes transforms from
  // layout, and the chart therefore painted its value axis across the
  // transaction rows underneath -- with the library's width/height props
  // transposed on top of that. Asserting the library is not called at all
  // is the guard against someone "simplifying" this back into a
  // `horizontal` BarChart.
  it("renders a ranking as its own rows, not a horizontal BarChart", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "payee" };
    const data = [datum({ key: "A Very Long Merchant Name" }), datum({ key: "Another One" })];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />);

    expect(mockBarChart).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("chart-rank-row")).toHaveLength(2);
  });

  // A pie or a line says nothing useful about "the ten biggest single
  // expenses", so a ranking stays a ranking whatever chart type the model
  // asked for.
  it("renders a ranking as rows even when the spec asks for a pie", async () => {
    const spec: QuerySpec = { chartType: "pie", groupBy: "transaction" };
    await renderWithTheme(
      <Chart data={[datum({ key: "Whole Foods — 3 Aug" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />
    );

    expect(mockPieChart).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("chart-rank-row")).toHaveLength(1);
  });

  // Bars are a share of the largest, so the top row is always full width
  // and the rest are readable against it without an axis to consult.
  it("sizes each ranking bar as its share of the largest", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "payee" };
    const data = [datum({ key: "Big", total: 400 }), datum({ key: "Small", total: 100 })];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />);

    const bars = screen.getAllByTestId("chart-rank-bar");
    expect(bars[0].props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: "100%" })]));
    expect(bars[1].props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: "25%" })]));
  });

  // These used to get no mark at all -- the icon axis was gated to category
  // groupings, so a ranking was a stack of anonymous bars sitting directly
  // above a list that showed a glyph on every row.
  it("marks each ranking row with the group's category icon", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "payee" };
    await renderWithTheme(
      <Chart
        data={[datum({ key: "Whole Foods", category: "Groceries" })]}
        spec={spec}
        CATS={CATS}
        selectedKey={null}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByTestId("chart-axis-icon-Groceries")).toBeTruthy();
  });

  it("tapping a ranking row calls onSelect with that row's key", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "payee" };
    const onSelect = jest.fn();
    await renderWithTheme(
      <Chart data={[datum({ key: "Whole Foods" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={onSelect} />
    );

    await fireEvent.press(screen.getByTestId("chart-rank-row"));
    expect(onSelect).toHaveBeenCalledWith("Whole Foods");
  });

  it("dims non-selected bars once a key is selected", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    const data = [datum({ key: "Groceries" }), datum({ key: "Dining" })];
    await renderWithTheme(<Chart data={data} spec={spec} CATS={CATS} selectedKey="Groceries" onSelect={jest.fn()} />);

    const props = mockBarChart.mock.calls[0][0];
    expect(props.data[0].opacity).toBe(1);
    expect(props.data[1].opacity).toBe(0.35);
  });

  it("BarChart selection calls onSelect with that bar's key", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    const onSelect = jest.fn();
    await renderWithTheme(<Chart data={[datum({ key: "Groceries" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={onSelect} />);
    mockBarChart.mock.calls[0][0].data[0].onPress();
    expect(onSelect).toHaveBeenCalledWith("Groceries");
  });

  it("colors bars by category only when grouped by category, not other groupings", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "day" };
    await renderWithTheme(<Chart data={[datum({ key: "2026-01-01" })]} spec={spec} CATS={CATS} selectedKey={null} onSelect={jest.fn()} />);
    const props = mockBarChart.mock.calls[0][0];
    expect(props.data[0].frontColor).toBe(lightColors.accent);
  });
});
