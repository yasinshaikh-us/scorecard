// Pure geometry/labelling helpers for the vertical charts in
// components/Chart.tsx. Kept out of the component (and free of any React
// Native import) because all three are arithmetic with a right answer,
// and arithmetic is far cheaper to test here than through a mocked
// charting library.
//
// They exist because react-native-gifted-charts' defaults are wrong for a
// phone-sized card in three separate ways:
//
//   1. Bar/point spacing is a fixed number of pixels, so a series longer
//      than the card is drawn wider than the card and the library turns
//      itself into a horizontal scroller. A chart you have to swipe to
//      finish reading is not a chart that fits.
//   2. Date group keys are ISO strings, and formatting each one in full
//      ("12 Aug 26") gives every bar a label three times wider than the
//      bar itself.
//   3. The y-axis is the data maximum cut into equal parts, so a series
//      topping out at $132.75 gets gridlines at $33.19, $66.38, $99.56 --
//      arithmetically correct, unreadable as money.

import { fmtGroupKey, isDateKey } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Floating-point tidy-up. 0.1 * 3 and 2.5e-1 * 4 both land a few ulps off
// a round number, which would otherwise surface as a "$0.30000000000000004"
// axis label.
const round = (n: number, places = 10) => Number(n.toFixed(places));

// The mantissas a person reads as a round step: 100, 250, 500, 1000. 3s,
// 4s and 7s are deliberately absent -- they divide evenly too, but nobody
// reads a $300 gridline as a landmark the way they read $250 or $500.
const STEP_MANTISSAS = [1, 2, 2.5, 5, 10];

// The section counts worth considering, in preference order: 4 gridlines
// is the established look, 5 and 3 are tried because they often reach a
// tighter axis for the same data (132.75 fits 3 x 50 = 150 exactly, where
// 4 sections would have to climb to 200 to stay round).
const SECTION_CHOICES = [4, 5, 3];

export type Scale = { max: number; step: number; sections: number };

// Smallest round step that is at least `rough`. `integer` is for a
// count axis, where "2.5 transactions" is not a gridline anyone can read:
// the fractional mantissas drop out and the step never falls below 1.
function niceStep(rough: number, integer: boolean): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = STEP_MANTISSAS.map((m) => round(m * magnitude)).filter((v) => !integer || Number.isInteger(v));
  const step = candidates.find((v) => v >= rough - 1e-9) ?? round(10 * magnitude);
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

// Picks the axis: a round step, and a maximum that is a whole number of
// those steps and clears the data. Among the section counts tried, the
// lowest ceiling wins -- that is the one that leaves the least dead space
// above the tallest bar -- with ties going to the earlier (more
// conventional) count.
export function niceScale(maxValue: number, integer = false): Scale {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: 1, step: 1, sections: 1 };

  let best: Scale | null = null;
  for (const sections of SECTION_CHOICES) {
    const step = niceStep(maxValue / sections, integer);
    const max = round(step * sections);
    if (!best || max < best.max) best = { max, step, sections };
  }
  return best as Scale;
}

// Strips a trailing ".0" / ".50" without touching an integer's own zeros
// ("1200" must not become "12").
const trim = (n: number, places: number) => n.toFixed(places).replace(/\.0+$|(\.\d*?)0+$/, "$1");

// "$0" / "$250" / "$2.5k" / "$1.2m". A gridline is a landmark, not a
// receipt, so it drops the cents an amount elsewhere in the app keeps and
// compacts thousands -- the y-axis gutter is 35dp wide and "$12,500.00"
// does not fit in it at 10pt.
export function fmtAxisMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000, 1)}m`;
  if (abs >= 1000) return `${sign}$${trim(abs / 1000, 1)}k`;
  if (Number.isInteger(abs)) return `${sign}$${abs}`;
  return `${sign}$${trim(abs, 2)}`;
}

// A count axis is a tally, not money: no currency, no cents, and the
// same compaction past a thousand so a busy merchant's visit count still
// fits the gutter.
export function fmtAxisCount(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}${trim(abs / 1000, 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

// Bottom-to-top gridline labels, which is the order gifted-charts'
// yAxisLabelTexts wants.
export function yAxisLabels(scale: Scale, format: (n: number) => string = fmtAxisMoney): string[] {
  return Array.from({ length: scale.sections + 1 }, (_, i) => format(round(scale.step * i)));
}

// A cashflow chart crosses zero: income above the axis, spending below.
// gifted-charts draws that from a positive scale plus a count of
// sections below the axis, all sharing one step -- so the same step has
// to cover both directions, and the labels run bottom-to-top across the
// whole range.
export type SignedScale = { scale: Scale; sectionsBelow: number; mostNegative: number };

export function signedScale(values: number[], integer = false): SignedScale {
  const highest = Math.max(0, ...values);
  const lowest = Math.min(0, ...values);
  const scale = niceScale(Math.max(highest, Math.abs(lowest)), integer);
  const sectionsBelow = lowest < 0 ? Math.ceil(Math.abs(lowest) / scale.step) : 0;
  // Guarded so an all-positive series reports 0 rather than -0.
  return { scale, sectionsBelow, mostNegative: sectionsBelow > 0 ? -round(sectionsBelow * scale.step) : 0 };
}

export function signedAxisLabels(
  { scale, sectionsBelow }: SignedScale,
  format: (n: number) => string = fmtAxisMoney
): string[] {
  const labels: string[] = [];
  for (let i = -sectionsBelow; i <= scale.sections; i++) labels.push(format(round(scale.step * i)));
  return labels;
}

// How many x-axis labels the card can hold. ~48dp each is what a
// "12 Aug" reads at comfortably at 10pt with air between neighbours.
export function labelBudget(plotWidth: number): number {
  return Math.max(3, Math.min(7, Math.floor(plotWidth / 48)));
}

const monthOf = (key: string) => MONTHS[parseInt(key.slice(5, 7), 10) - 1];
const yearOf = (key: string) => key.slice(2, 4);

// The Sunday a week key names, plus six days -- the week's last day, used
// to label the group as the span it actually covers.
function weekEndDay(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 6 * 86400000).getUTCDate();
}

// Labels a date axis by PERIOD rather than by date: the day-of-month (or,
// for a week, the span of days it covers) carries the position, and the
// month and year appear only where they change -- which is exactly where
// they carry information. So ninety days of spending reads
//
//     1 Aug '26      8        15        22        29      1 Sep
//
// instead of ninety copies of "12 Aug 26" overlapping into a grey smear.
// Labels are also thinned to `maxLabels`, anchored at the last group so
// the most recent period is always named.
//
// Non-date groupings (account names, and anything else that reaches a
// vertical axis) have no period structure to exploit and keep their full
// label.
export function periodLabels(keys: string[], groupBy: string, maxLabels: number): string[] {
  if (!isDateKey(groupBy)) return keys.map((k) => fmtGroupKey(k, groupBy));

  const stride = Math.max(1, Math.ceil(keys.length / Math.max(maxLabels, 1)));
  const shown = new Set<number>();
  for (let i = keys.length - 1; i >= 0; i -= stride) shown.add(i);

  let prev: string | null = null;
  return keys.map((key, i) => {
    if (!shown.has(i)) return "";
    const newMonth = prev === null || key.slice(0, 7) !== prev.slice(0, 7);
    const newYear = prev === null || key.slice(0, 4) !== prev.slice(0, 4);
    prev = key;

    if (groupBy === "month") {
      // A month grouping is already one label per month, so the month
      // itself is the position and only the year is conditional.
      return newYear ? `${monthOf(key)} '${yearOf(key)}` : monthOf(key);
    }

    const day = parseInt(key.slice(8, 10), 10);
    const head = groupBy === "week" ? `${day}–${weekEndDay(key)}` : `${day}`;
    if (newYear) return `${head} ${monthOf(key)} '${yearOf(key)}`;
    if (newMonth) return `${head} ${monthOf(key)}`;
    return head;
  });
}

// Bars/points are sized to the space available instead of to a fixed
// pixel width, so the series ends where the card ends however many groups
// it holds.
//
// The number to fit under is gifted-charts' own content width, which its
// chart wrapper computes as
//
//     initialSpacing + 2 * endSpacing + (the bars/gaps between them)
//
// -- endSpacing counted twice, and the trailing gap after the last bar
// dropped. Anything wider than the `width` prop becomes scrollable (or,
// with scrolling off, clipped), so the arithmetic below targets that
// expression exactly rather than the more obvious "sum of the parts".
const MAX_BAR = 22;
const MAX_GAP = 28;
// Air between the y-axis and the first bar, and past the last one.
const EDGE = 6;
// A data point is drawn centred on its x position, so a line chart's
// content is its own radius wider than the points it joins. Covers the
// 5dp a selected point grows to, not just the 4dp default.
const POINT_ALLOWANCE = 6;

// Truncated, never rounded: a bar width rounded UP by a hundredth of a
// point is multiplied by the group count, and a series that overshoots
// its own plot by a fraction of a pixel is a series the library decides
// to make scrollable.
const floor2 = (n: number) => Math.floor(n * 100) / 100;

// Splits whatever the bars/points left unspent into the two margins the
// library actually applies: initialSpacing once on the left, endSpacing
// twice on the right. Halving the slack for the left and quartering it
// for each of the right's two shares puts equal air on both sides.
const margins = (slack: number) => ({
  initialSpacing: floor2(Math.max(slack, 0) / 2),
  endSpacing: floor2(Math.max(slack, 0) / 4),
});

export type BarGeometry = { barWidth: number; spacing: number; initialSpacing: number; endSpacing: number };

export function barGeometry(plotWidth: number, count: number): BarGeometry {
  const n = Math.max(count, 1);
  const inner = Math.max(plotWidth - 2 * EDGE, 1);
  const unit = inner / n;
  // `unit` caps the bar as well as the proportion does: at more groups
  // than pixels the 0.62 share would still round up past its own slot and
  // put the series back over the edge.
  const barWidth = floor2(Math.max(Math.min(unit * 0.62, MAX_BAR, unit), 0.5));
  const spacing = floor2(Math.max(Math.min(unit - barWidth, MAX_GAP), 0));
  // n bars with a gap BETWEEN them -- the gap after the last one is the
  // one the wrapper drops.
  const series = n * barWidth + (n - 1) * spacing;
  return { barWidth, spacing, ...margins(plotWidth - series) };
}

export type LineGeometry = { spacing: number; initialSpacing: number; endSpacing: number };

export function lineGeometry(plotWidth: number, count: number): LineGeometry {
  const n = Math.max(count, 1);
  const inner = Math.max(plotWidth - 2 * EDGE - POINT_ALLOWANCE, 1);
  const spacing = floor2(n > 1 ? inner / (n - 1) : inner);
  const series = (n - 1) * spacing + POINT_ALLOWANCE;
  return { spacing, ...margins(plotWidth - series) };
}

// What gifted-charts will make the plot's content -- the check the two
// functions above exist to satisfy, and what their tests assert on.
export function contentWidth(
  g: { spacing: number; initialSpacing: number; endSpacing: number; barWidth?: number },
  count: number
): number {
  const n = Math.max(count, 1);
  const series = g.barWidth !== undefined ? n * g.barWidth + (n - 1) * g.spacing : (n - 1) * g.spacing + POINT_ALLOWANCE;
  return g.initialSpacing + 2 * g.endSpacing + series;
}
