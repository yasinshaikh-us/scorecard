import { useState } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import { fmtGroupKey, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { iconForCategory } from "../lib/categoryIcons";
import { topCategory, type ChartDatum, type QuerySpec } from "../lib/logic";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

const SCREEN_WIDTH = Dimensions.get("window").width;

// gifted-charts renders the y-axis labels in a gutter to the LEFT of the
// plot and adds it to the plot's own width, so the box on screen is
// `yAxisLabelWidth + width`, not `width`. Passed explicitly rather than
// left to the library's default (also 35) so the arithmetic below can't
// silently drift if that default ever changes.
const Y_AXIS_GUTTER = 35;

// Fallback until onLayout reports the real figure -- roughly the Ask
// card's inner width (screen, less the list's horizontal padding and the
// card's own). Only ever used for the first paint of the first chart.
const ASSUMED_WIDTH = SCREEN_WIDTH - 60;

// Bar geometry for a horizontal ranking. Passed to the chart AND used to
// work out how much vertical room to reserve for it, so the two can't
// disagree -- they did, and the chart drew over the list beneath it.
const BAR_THICKNESS = 18;
const BAR_GAP = 14;
const EDGE_SPACING = 20;
const MAX_BARS = 14;

// The band gifted-charts paints below the value axis for its labels. It
// sits OUTSIDE the height the chart reserves in layout: React Native
// transforms (which is how `horizontal` is implemented -- the wrapper
// rotates the container) do not affect layout at all, so the rotated
// chart's footprint is not what it paints. Without reserving this, the
// axis numbers landed on top of the transaction rows below the card.
const AXIS_LABEL_BAND = 56;

// Bar/pie/line chart with tap-to-select: tapping a bar/slice/point selects
// it (filters the transaction list below to just that group), tapping the
// same one again deselects. Merchant totals and individual-transaction
// rankings ("payee"/"transaction" groupBy) use long, variable-width
// labels, so those render as horizontal bars instead of vertical -- a
// vertical axis can't fit them legibly.
export default function Chart({
  data,
  spec,
  CATS,
  selectedKey,
  onSelect,
}: {
  data: ChartDatum[];
  spec: QuerySpec;
  CATS: string[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { colors, mode } = useTheme();
  // Measured, not derived from Dimensions: the chart sits inside
  // QueryCard, inside a padded list, so screen width minus a guessed
  // constant was always going to be wrong by whatever those paddings
  // happen to be. It was -- the guess (screen - 64) omitted the y-axis
  // gutter entirely, so every chart drew ~35dp past the card's right
  // edge and clipped its own last axis label.
  const [available, setAvailable] = useState(ASSUMED_WIDTH);
  const axisLabelStyle = { color: colors.textMuted, fontSize: 10, fontFamily: fontFamily.regular };

  if (data.length === 0) return null;

  const longLabelChart = spec.groupBy === "payee" || spec.groupBy === "transaction";
  // What's left for the plot itself once the axis gutter has its share.
  const width = available - Y_AXIS_GUTTER;

  if (spec.chartType === "pie") {
    const pieData = data.map((d) => ({
      value: d.total,
      color: spec.groupBy === "category" ? catColor(d.key, CATS, topCategory, mode) : undefined,
      text: undefined,
      strokeColor: selectedKey === d.key ? colors.text : undefined,
      strokeWidth: selectedKey === d.key ? 2 : 0,
      onPress: () => onSelect(d.key),
    }));
    return (
      <View style={styles.wrap}>
        <PieChart data={pieData} radius={90} donut showText={false} focusOnPress />
      </View>
    );
  }

  if (spec.chartType === "line") {
    const lineData = data.map((d) => ({
      value: d.total,
      label: fmtGroupKey(d.key, spec.groupBy || ""),
      dataPointColor: selectedKey === d.key ? colors.accent : colors.surface,
      dataPointRadius: selectedKey === d.key ? 5 : 4,
      onPress: () => onSelect(d.key),
    }));
    return (
      <View style={styles.wrap} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
        <LineChart
          data={lineData}
          width={width}
          height={200}
          yAxisLabelWidth={Y_AXIS_GUTTER}
          color={colors.accent}
          thickness={2}
          dataPointsColor={colors.accent}
          xAxisLabelTextStyle={axisLabelStyle}
          yAxisTextStyle={axisLabelStyle}
          curved
          isAnimated={false}
        />
      </View>
    );
  }

  // A category axis labels with the category's own icon, not its name.
  // Names are what made this axis width-bound: eight categories already
  // truncated to "Entertai…", and the closed set has nineteen. An icon is
  // a fixed 14px whatever the name's length, so bar count stops competing
  // with label legibility -- and it's the same glyph, in the same palette
  // color, that marks the category on every transaction row below.
  // Horizontal (payee/transaction) bars get the same treatment. They used
  // to get no axis mark at all -- the `&& !longLabelChart` that used to sit
  // here excluded them -- so a ranking chart was a stack of anonymous bars
  // whose own list, directly underneath, showed the glyph for every row.
  // topCategory() resolves the dominant category for those groupings too,
  // so it's the same glyph in the same palette colour, just on the axis the
  // bars actually run from.
  const iconAxis = spec.groupBy === "category" || longLabelChart;

  const barData = data.map((d) => {
    const color = spec.groupBy === "category" ? catColor(d.key, CATS, topCategory, mode) : colors.accent;
    // For a category chart the key IS the category; for a ranking the key
    // is a merchant or a payee-and-date, and the category rides along on
    // the datum (see buildChartData). Running topCategory() over a
    // merchant name instead just yields the merchant name back, which
    // resolves to the fallback glyph -- the "?" on every bar.
    const category = spec.groupBy === "category" ? topCategory(d.key) : d.category;
    const Icon = iconAxis && category ? iconForCategory(category) : null;
    return {
      value: d.total,
      label: iconAxis ? undefined : fmtGroupKey(d.key, spec.groupBy || ""),
      labelComponent:
        Icon && category
          ? () => (
              <View testID={`chart-axis-icon-${category}`} accessibilityLabel={category} style={styles.axisIcon}>
                <Icon size={14} color={color} />
              </View>
            )
          : undefined,
      frontColor: color,
      opacity: selectedKey && selectedKey !== d.key ? 0.35 : 1,
      onPress: () => onSelect(d.key),
    };
  });

  // How far the stack of bars runs down the screen, derived from the bar
  // geometry rather than a round number per row. `data.length * 36` against
  // 18 + 14 = 32dp of actual pitch, capped at 320, ran a ten-row ranking
  // past the end of its own axis: the last three bars and their icons
  // simply weren't drawn. buildChartData already caps a ranking at ten
  // rows (spec.limit can ask for more), so the cap here is a backstop
  // against a runaway series rather than the usual case.
  const barsExtent = Math.min(data.length, MAX_BARS) * (BAR_THICKNESS + BAR_GAP) + EDGE_SPACING * 2;

  // `width` and `height` are TRANSPOSED when `horizontal` is set --
  // gifted-charts-core reads them as
  //
  //   heightFromProps = horizontal ? props.width  : props.height
  //   widthFromProps  = horizontal ? props.height : props.width
  //
  // (gifted-charts-core/dist/BarChart/index.js). Passing the on-screen
  // dimensions in their natural slots therefore produced a chart rotated
  // in its own box: a one-bar ranking rendered 36dp wide and ~350dp tall,
  // overflowing the card horizontally while padding it out vertically
  // with the better part of a blank screen. Naming both extents and
  // swapping them here keeps the call site readable -- the alternative,
  // writing the swap inline, is what made this look correct for months.
  return (
    <View
      style={[styles.wrap, longLabelChart ? { height: barsExtent + AXIS_LABEL_BAND } : null]}
      onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
    >
      <BarChart
        data={barData}
        width={longLabelChart ? barsExtent : width}
        height={longLabelChart ? width : 200}
        horizontal={longLabelChart}
        yAxisLabelWidth={Y_AXIS_GUTTER}
        barWidth={longLabelChart ? BAR_THICKNESS : 22}
        spacing={longLabelChart ? BAR_GAP : 18}
        // Pinned rather than left to the library's defaults, which differ
        // per chart type: barsExtent is computed from these exact numbers,
        // and a default drifting from them is what silently truncates the
        // last rows of a ranking.
        initialSpacing={EDGE_SPACING}
        endSpacing={EDGE_SPACING}
        xAxisLabelTextStyle={axisLabelStyle}
        yAxisTextStyle={axisLabelStyle}
        noOfSections={4}
        isAnimated={false}
      />
    </View>
  );
}

// Not currently wired to a live tooltip (gifted-charts' pointer/tooltip
// config is a larger lift than this first pass needs) -- fmtMoney is kept
// here for the day a tooltip/label formatter is added, so amounts read as
// "$12.34" rather than a bare number.
export const formatValue = fmtMoney;

const styles = StyleSheet.create({
  wrap: { alignItems: "center", marginBottom: 12 },
  axisIcon: { alignItems: "center", justifyContent: "center", paddingTop: 4 },
});
