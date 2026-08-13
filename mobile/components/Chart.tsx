import { Dimensions, StyleSheet, View } from "react-native";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import { fmtGroupKey, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { iconForCategory } from "../lib/categoryIcons";
import { topCategory, type ChartDatum, type QuerySpec } from "../lib/logic";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

const SCREEN_WIDTH = Dimensions.get("window").width;

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
  const axisLabelStyle = { color: colors.textMuted, fontSize: 10, fontFamily: fontFamily.regular };

  if (data.length === 0) return null;

  const longLabelChart = spec.groupBy === "payee" || spec.groupBy === "transaction";
  const width = SCREEN_WIDTH - 64;

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
      <View style={styles.wrap}>
        <LineChart
          data={lineData}
          width={width}
          height={200}
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
  const iconAxis = spec.groupBy === "category" && !longLabelChart;

  const barData = data.map((d) => {
    const color = spec.groupBy === "category" ? catColor(d.key, CATS, topCategory, mode) : colors.accent;
    const Icon = iconAxis ? iconForCategory(topCategory(d.key)) : null;
    return {
      value: d.total,
      label: longLabelChart || iconAxis ? undefined : fmtGroupKey(d.key, spec.groupBy || ""),
      labelComponent: Icon
        ? () => (
            <View
              testID={`chart-axis-icon-${topCategory(d.key)}`}
              accessibilityLabel={topCategory(d.key)}
              style={styles.axisIcon}
            >
              <Icon size={14} color={color} />
            </View>
          )
        : undefined,
      frontColor: color,
      opacity: selectedKey && selectedKey !== d.key ? 0.35 : 1,
      onPress: () => onSelect(d.key),
    };
  });

  return (
    <View style={styles.wrap}>
      <BarChart
        data={barData}
        width={width}
        height={longLabelChart ? Math.min(data.length * 36, 320) : 200}
        horizontal={longLabelChart}
        barWidth={longLabelChart ? 18 : 22}
        spacing={longLabelChart ? 14 : 18}
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
