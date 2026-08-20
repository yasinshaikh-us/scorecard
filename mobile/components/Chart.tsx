import { useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { BarChart, LineChart, PieChart } from "react-native-gifted-charts";
import { fmtGroupKey, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { iconForCategory } from "../lib/categoryIcons";
import { topCategory, type ChartDatum, type QuerySpec } from "../lib/logic";
import { barGeometry, fmtAxisCount, fmtAxisMoney, labelBudget, lineGeometry, niceScale, periodLabels, yAxisLabels } from "../lib/chartAxis";
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

// A ranking ("payee"/"transaction") is drawn here rather than by
// gifted-charts, and that is a deliberate retreat from its `horizontal`
// mode after three rounds of chasing the same class of defect.
//
// That mode is implemented by ROTATING the chart's container, and React
// Native excludes transforms from layout -- so the area the chart paints
// is structurally not the box it reserves. In practice: the value axis and
// its labels painted across the transaction rows underneath, and the only
// lever was to reverse-engineer the library's internal padding and reserve
// it by hand, a constant fitted to one screenshot on one device that a
// different row count or screen size would invalidate again. The library's
// own props (width/height) are also transposed in that mode, which is how
// this got shipped drawing sideways in the first place.
//
// A ranking is a row per item: a mark, a bar as long as its share of the
// largest, and the amount. Percentage widths need no measurement, no
// transform, and no axis arithmetic, so the layout is exactly what it
// says. The amount carries the scale the dropped axis used to.
//
// Vertical charts (category/day/week/month) keep using gifted-charts:
// nothing above applies to them, and they have a real value axis worth
// having.
function RankingChart({
  data,
  colors,
  iconFor,
  fmtValue,
  selectedKey,
  onSelect,
}: {
  data: ChartDatum[];
  colors: ReturnType<typeof useTheme>["colors"];
  iconFor: (d: ChartDatum) => { Icon: ReturnType<typeof iconForCategory> | null; category?: string };
  fmtValue: (n: number) => string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const max = Math.max(...data.map((d) => d.total));

  return (
    <View style={styles.rankWrap}>
      {data.map((d) => {
        const { Icon, category } = iconFor(d);
        // A zero-total group would divide by zero; a ranking of nothing
        // spent is degenerate but reachable via a filter that matches only
        // refunds.
        const share = max > 0 ? d.total / max : 0;
        const dimmed = selectedKey !== null && selectedKey !== d.key;
        return (
          <Pressable
            key={d.key}
            testID="chart-rank-row"
            accessibilityLabel={`${fmtGroupKey(d.key, "payee")}, ${fmtValue(d.total)}`}
            onPress={() => onSelect(d.key)}
            style={[styles.rankRow, dimmed ? styles.rankRowDimmed : null]}
          >
            <View
              testID={category ? `chart-axis-icon-${category}` : "chart-rank-icon"}
              accessibilityLabel={category}
              style={styles.rankIcon}
            >
              {Icon ? <Icon size={14} color={colors.accent} /> : null}
            </View>
            {/* The track is what makes a short bar readable as "short"
                rather than as a rendering failure -- without it the two
                smallest rows in a ranking are a few pixels of colour
                floating in white space. */}
            <View style={[styles.rankTrack, { backgroundColor: colors.surfaceRecessed }]}>
              <View
                testID="chart-rank-bar"
                style={[
                  styles.rankFill,
                  // Percent of the track, so this needs no measurement and
                  // survives any card width.
                  { width: `${Math.max(share * 100, share > 0 ? 1.5 : 0)}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <Text
              style={[styles.rankAmount, { color: colors.textMuted, fontFamily: fontFamily.mono }]}
              numberOfLines={1}
            >
              {fmtValue(d.total)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Bar/pie/line chart with tap-to-select: tapping a bar/slice/point selects
// it (filters the transaction list below to just that group), tapping the
// same one again deselects. Merchant totals and individual-transaction
// rankings ("payee"/"transaction" groupBy) render as horizontal bars
// instead of vertical -- a vertical axis can't fit their long,
// variable-width labels legibly -- via RankingChart above.
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

  // A count axis is a tally of transactions, not an amount, so both the
  // gridlines and the ranking rows drop the currency -- and the scale is
  // held to whole numbers, since "2.5 transactions" is not a landmark.
  const counting = spec.metric === "count";
  const fmtValue = counting ? (n: number) => `${Math.round(n)}` : fmtMoney;
  const fmtAxis = counting ? fmtAxisCount : fmtAxisMoney;

  const longLabelChart = spec.groupBy === "payee" || spec.groupBy === "transaction";
  // What's left for the plot itself once the axis gutter has its share.
  const width = available - Y_AXIS_GUTTER;

  // Ahead of the chartType branches on purpose: a ranking is a ranking
  // whatever chart type the model asked for, and neither a pie nor a line
  // says anything useful about "the ten biggest single expenses".
  if (longLabelChart) {
    return (
      <RankingChart
        data={data}
        colors={colors}
        fmtValue={fmtValue}
        iconFor={(d) => ({ Icon: d.category ? iconForCategory(d.category) : null, category: d.category })}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
    );
  }

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

  // Gridlines at round money -- 0/250/500/750/1000 rather than the equal
  // slices of the data maximum the library picks on its own, which land
  // on figures like $132.75 that say nothing when read against a bar. The
  // scale's own max is what the bars are drawn against, so the tallest bar
  // stops below the top gridline rather than at it; that headroom is the
  // price of the axis being readable.
  const scale = niceScale(Math.max(...data.map((d) => d.total)), counting);
  const axisScale = {
    maxValue: scale.max,
    noOfSections: scale.sections,
    stepValue: scale.step,
    yAxisLabelTexts: yAxisLabels(scale, fmtAxis),
  };

  if (spec.chartType === "line") {
    const labels = periodLabels(
      data.map((d) => d.key),
      spec.groupBy || "",
      labelBudget(width)
    );
    const lineData = data.map((d, i) => ({
      value: d.total,
      label: labels[i],
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
          {...lineGeometry(width, data.length)}
          {...axisScale}
          disableScroll
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
  // Rankings are handled by RankingChart above and never reach here.
  const iconAxis = spec.groupBy === "category";

  const labels = periodLabels(
    data.map((d) => d.key),
    spec.groupBy || "",
    labelBudget(width)
  );

  const barData = data.map((d, i) => {
    const color = iconAxis ? catColor(d.key, CATS, topCategory, mode) : colors.accent;
    const category = iconAxis ? topCategory(d.key) : null;
    const Icon = category ? iconForCategory(category) : null;
    return {
      value: d.total,
      label: iconAxis ? undefined : labels[i],
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

  return (
    <View style={styles.wrap} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
      <BarChart
        data={barData}
        width={width}
        height={200}
        yAxisLabelWidth={Y_AXIS_GUTTER}
        {...barGeometry(width, data.length)}
        {...axisScale}
        disableScroll
        xAxisLabelTextStyle={axisLabelStyle}
        yAxisTextStyle={axisLabelStyle}
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

  // A ranking's own rows. Ordinary flex layout, so the block is exactly as
  // tall as its rows and cannot paint over what follows it -- which is the
  // entire reason this exists rather than a `horizontal` BarChart.
  rankWrap: { marginBottom: 12 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  rankRowDimmed: { opacity: 0.35 },
  rankIcon: { flexBasis: 18, flexGrow: 0, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  rankTrack: { flex: 1, minWidth: 0, height: 14, borderRadius: 3, overflow: "hidden" },
  rankFill: { height: "100%", borderRadius: 3 },
  // Matches the transaction rows below: same right-hand column, same
  // tabular figures, so the two read as one table rather than a chart and
  // an unrelated list.
  rankAmount: { flexBasis: 96, flexGrow: 0, flexShrink: 0, textAlign: "right", fontSize: 12 },
});
