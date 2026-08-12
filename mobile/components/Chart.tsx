import { Dimensions, StyleSheet, View } from "react-native";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import { fmtGroupKey, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory, type ChartDatum, type QuerySpec } from "../lib/logic";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";

const SCREEN_WIDTH = Dimensions.get("window").width;

// Bar/pie/line chart with tap-to-select, mirroring src/QueryCard.jsx's
// Recharts version: tapping a bar/slice/point selects it (filters the
// transaction list below to just that group), tapping the same one again
// deselects. Merchant totals and individual-transaction rankings
// ("payee"/"transaction" groupBy) use long, variable-width labels, so
// those render as horizontal bars instead of vertical -- same reasoning
// as the web version's longLabelChart flag.
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
  const { colors } = useTheme();
  const axisLabelStyle = { color: colors.textMuted, fontSize: 10, fontFamily: fontFamily.regular };

  if (data.length === 0) return null;

  const longLabelChart = spec.groupBy === "payee" || spec.groupBy === "transaction";
  const width = SCREEN_WIDTH - 64;

  if (spec.chartType === "pie") {
    const pieData = data.map((d) => ({
      value: d.total,
      color: spec.groupBy === "category" ? catColor(d.key, CATS, topCategory) : undefined,
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

  const barData = data.map((d) => ({
    value: d.total,
    label: longLabelChart ? undefined : fmtGroupKey(d.key, spec.groupBy || ""),
    frontColor: spec.groupBy === "category" ? catColor(d.key, CATS, topCategory) : colors.accent,
    opacity: selectedKey && selectedKey !== d.key ? 0.35 : 1,
    onPress: () => onSelect(d.key),
  }));

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
});
