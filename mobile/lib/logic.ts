// Ported from /src/logic.js -- same pure filter/group/parse logic the web
// app uses, kept behaviorally identical (including comments explaining
// the non-obvious parts) so the two clients answer the same question the
// same way. No React Native dependencies here -- this is the same file
// content-wise as the web version, just typed.

import type { Transaction } from "./types";
import { daysBefore, fmtDate, isDateKey } from "./format";
import { normalizeSpec } from "./specSchema";

export const topCategory = (cat: string) => (cat || "Uncategorized").split(":")[0];

// Filters out rows missing a required field and coerces types into a
// clean {Id, Date, Payee, Category, Amount, Account, IsTransfer} shape --
// mirrors the `transactions` Edge Function's own shape, so this is really
// just defensive coercion of already-well-shaped data from the server.
export function cleanRows(rows: any[]): Transaction[] {
  return rows
    .filter((r) => r.Date && r.Payee && r.Category && r.Amount !== undefined && r.Amount !== null && !isNaN(r.Amount))
    .map((r) => ({
      Id: r.Id,
      Date: String(r.Date).trim(),
      Payee: String(r.Payee).trim(),
      Category: String(r.Category).trim(),
      Amount: Number(r.Amount),
      Account: r.Account ? String(r.Account).trim() : "Manual entry",
      IsTransfer: !!r.IsTransfer,
    }));
}

// Computes the derived lookups the rest of the app relies on for
// rendering (category color ordering) from a flat array of transactions.
export function computeDataMeta(rows: Transaction[]) {
  const CATS = [...new Set(rows.map((d) => topCategory(d.Category)))];
  return { CATS };
}

export type QuerySpec = {
  isLedgerQuery?: boolean;
  categories?: string[] | null;
  // Top-level categories to drop from an otherwise-matching set. Exists
  // because a "spending over time" chart is dominated by whatever the
  // ledger's largest one-off purchases are -- a single six-figure
  // Investments row flattens twelve months of everyday spending into
  // slivers -- and because a question can ask for the exclusion outright
  // ("everything except rent").
  excludeCategories?: string[] | null;
  categoryContains?: string | null;
  payeeContains?: string | null;
  // Several merchants at once: "Chipotle vs Sweetgreen" is one question,
  // and a single substring can't express it.
  payeeAny?: string[] | null;
  accountContains?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  type?: "expense" | "income" | "transfer" | "all";
  includeTransfers?: boolean;
  amountMin?: number | null;
  amountMax?: number | null;
  limit?: number | null;
  chartType?: "bar" | "pie" | "line" | "none";
  groupBy?: "category" | "day" | "week" | "month" | "quarter" | "year" | "payee" | "account" | "transaction" | "none";
  // What each bucket measures. Everything used to be a sum of amounts,
  // which left "how often do I go there" answerable only in dollars.
  metric?: "sum" | "count" | "avg" | "net" | "median";
  // Restricts the set to payees that bill on a regular cadence -- what a
  // question about subscriptions is actually asking for. Not a row-wise
  // filter (regularity is a property of a payee's whole history), so it
  // is applied by filterRecurring rather than by filterTransactions.
  recurringOnly?: boolean;
  // Re-runs the same filter over the equal-length window immediately
  // before this one, so the card can answer "more or less than last
  // time".
  compareTo?: "previous" | null;
  // A number the question named to measure spending against ("am I on
  // track for $500 on dining?").
  target?: number | null;
  title?: string;
};

// Applies a query spec's filter fields to a rows array.
//
// IsTransfer rows (internal transfers between the user's own linked
// accounts, e.g. savings -> checking) are excluded by default, not just
// when type is "expense"/"income": once a person has more than one
// account, a transfer shows up as an expense row on one account and an
// income row on the other, so leaving it in would double-count it in any
// "all" or unfiltered total too. spec.type === "transfer" or
// spec.includeTransfers === true opt back in for questions that are
// actually about the transfers themselves.
export function filterTransactions(rows: Transaction[], spec: QuerySpec | null): Transaction[] {
  if (!spec) return [];
  return rows.filter((d) => {
    const isTransfer = !!d.IsTransfer;
    if (spec.type === "transfer") {
      if (!isTransfer) return false;
    } else if (isTransfer && !spec.includeTransfers) {
      return false;
    }
    if (spec.categories && spec.categories.length && !spec.categories.includes(topCategory(d.Category))) return false;
    if (spec.excludeCategories && spec.excludeCategories.includes(topCategory(d.Category))) return false;
    if (spec.categoryContains && !d.Category.toLowerCase().includes(spec.categoryContains.toLowerCase())) return false;
    if (spec.payeeContains && !d.Payee.toLowerCase().includes(spec.payeeContains.toLowerCase())) return false;
    if (spec.payeeAny && spec.payeeAny.length) {
      const payee = d.Payee.toLowerCase();
      if (!spec.payeeAny.some((p) => payee.includes(p.toLowerCase()))) return false;
    }
    if (spec.accountContains && !(d.Account || "").toLowerCase().includes(spec.accountContains.toLowerCase())) return false;
    if (spec.dateStart && d.Date < spec.dateStart) return false;
    if (spec.dateEnd && d.Date > spec.dateEnd) return false;
    if (spec.type === "expense" && d.Amount >= 0) return false;
    if (spec.type === "income" && d.Amount <= 0) return false;
    const mag = Math.abs(d.Amount);
    if (spec.amountMin != null && mag < spec.amountMin) return false;
    if (spec.amountMax != null && mag > spec.amountMax) return false;
    return true;
  });
}

// The chart/table grouping key for a single row under a given spec.
export function groupKeyOf(spec: QuerySpec | null, d: Transaction): string {
  if (!spec) return "";
  if (spec.groupBy === "category") return topCategory(d.Category);
  if (spec.groupBy === "payee") return d.Payee;
  if (spec.groupBy === "account") return d.Account || "Manual entry";
  // "transaction" ranks individual rows rather than summing them into a
  // group (see buildChartData) -- the key doubles as the bar's label, so
  // it's the payee + date rather than a bare id.
  if (spec.groupBy === "transaction") return `${d.Payee} — ${fmtDate(d.Date)}`;
  if (spec.groupBy === "day") return d.Date;
  if (spec.groupBy === "month") return d.Date.slice(0, 7);
  if (spec.groupBy === "year") return d.Date.slice(0, 4);
  if (spec.groupBy === "quarter") {
    const month = parseInt(d.Date.slice(5, 7), 10);
    return `${d.Date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
  if (spec.groupBy === "week") {
    // Computed entirely in UTC-anchored arithmetic (Date.UTC + getUTCDay),
    // never through a locally-parsed Date or toISOString() round trip --
    // that would parse d.Date as local midnight and convert the result
    // back to UTC, silently shifting the computed week-start back a day
    // for viewers in positive-UTC-offset timezones.
    const [y, m, day] = d.Date.split("-").map(Number);
    const utcMs = Date.UTC(y, m - 1, day);
    const dayOfWeek = new Date(utcMs).getUTCDay();
    return new Date(utcMs - dayOfWeek * 86400000).toISOString().slice(0, 10);
  }
  return "";
}

// `category` is the group's dominant top-level category by spend -- for a
// payee/account grouping the key is a merchant or account name, which
// carries no category of its own, so the chart has nothing to draw an
// axis glyph from without this. Dominant by total rather than by count so
// it agrees with the bar's own length: a merchant with one large
// Groceries charge and three small Dining ones is a Groceries bar.
// `total` is what the chart plots, which is not always a sum of money any
// more: under metric "count" it is a number of transactions and under
// "avg" the average one. `sum` and `count` stay the raw figures whatever
// the metric, so the stat line can report all three without re-deriving
// them. `keys` is set only on an aggregated bucket ("Other" on a capped
// pie), naming every group key it stands for so tapping it can still
// filter the list below.
export type ChartDatum = {
  key: string;
  total: number;
  sum: number;
  // Signed, unlike `sum`: income counts up and expenses count down, which
  // is what a cashflow question is asking for and what `sum` (built on
  // magnitudes) can never express. Optional so a hand-built datum (tests,
  // fixtures) doesn't have to state it; buildChartData always does.
  net?: number;
  count: number;
  category?: string;
  row?: Transaction;
  keys?: string[];
};

// Builds the {key, total, count} chart series from already-filtered rows:
// groups by groupKeyOf, sorts chronologically for date-based groupings
// (descending total otherwise), and caps merchant/transaction rankings to
// spec.limit (defaulting to 10 when the question didn't name a count) so
// the chart never renders an unbounded list.
export function buildChartData(filteredRows: Transaction[], spec: QuerySpec | null): ChartDatum[] {
  if (!spec || spec.groupBy === "none") return [];

  // Ranks individual transactions by size rather than summing them into
  // groups -- each row stays its own entry, carrying the original
  // transaction back via `row` so the list below the chart can show
  // exactly this ranked/capped set. A metric has nothing to average or
  // count over one transaction, so this branch is always the amount.
  if (spec.groupBy === "transaction") {
    const arr = filteredRows.map((d) => ({
      key: groupKeyOf(spec, d),
      total: Math.abs(d.Amount),
      sum: Math.abs(d.Amount),
      net: d.Amount,
      count: 1,
      category: topCategory(d.Category),
      row: d,
    }));
    arr.sort((a, b) => b.total - a.total);
    const cap = spec.limit || 10;
    return arr.slice(0, cap);
  }

  // Spend per top-level category within each group, so the group can be
  // labelled with whichever category accounts for most of it.
  const categoryTotals: Record<string, Record<string, number>> = {};
  const map: Record<string, ChartDatum> = {};
  // Kept beside the buckets rather than on them: a median needs every
  // amount in the bucket, and nothing downstream wants to carry that.
  const amounts: Record<string, number[]> = {};
  filteredRows.forEach((d) => {
    const k = groupKeyOf(spec, d);
    if (!map[k]) map[k] = { key: k, total: 0, sum: 0, net: 0, count: 0 };
    map[k].sum += Math.abs(d.Amount);
    map[k].net = (map[k].net ?? 0) + d.Amount;
    map[k].count += 1;
    (amounts[k] ||= []).push(Math.abs(d.Amount));

    const cat = topCategory(d.Category);
    if (!categoryTotals[k]) categoryTotals[k] = {};
    categoryTotals[k][cat] = (categoryTotals[k][cat] || 0) + Math.abs(d.Amount);
  });
  for (const k of Object.keys(map)) {
    const totals = categoryTotals[k];
    map[k].category = Object.keys(totals).reduce((best, cat) => (totals[cat] > totals[best] ? cat : best));
    map[k].total = spec.metric === "median" ? median(amounts[k]) : metricValue(map[k], spec.metric);
  }
  let arr = Object.values(map);
  if (isDateKey(spec.groupBy || "")) {
    arr.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    arr.sort((a, b) => b.total - a.total);
    const defaultCap = spec.groupBy === "payee" ? 10 : null;
    const cap = spec.limit || defaultCap;
    if (cap && arr.length > cap) arr = arr.slice(0, cap);
    if (spec.chartType === "pie") arr = capPieSlices(arr, spec.metric);
  }
  return arr;
}

export function metricValue(d: { sum: number; count: number; net?: number }, metric: QuerySpec["metric"]): number {
  if (metric === "count") return d.count;
  if (metric === "avg") return d.count > 0 ? d.sum / d.count : 0;
  if (metric === "net") return d.net ?? 0;
  return d.sum;
}

// The middle amount, which answers "what does a typical one cost" in a
// way an average cannot: one $400 grocery haul drags a mean of $60
// upward, and the median stays where most of the runs actually are.
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A donut of nineteen categories is a colour wheel, not a comparison: the
// tail slices are a degree wide each and their labels have nowhere to go.
// The five biggest keep their own slice and everything else becomes one
// "Other", which carries the keys it swallowed so tapping it still
// filters the transaction list to exactly those groups.
const PIE_SLICES = 6;

export function capPieSlices(sorted: ChartDatum[], metric: QuerySpec["metric"]): ChartDatum[] {
  if (sorted.length <= PIE_SLICES) return sorted;
  const kept = sorted.slice(0, PIE_SLICES - 1);
  const rest = sorted.slice(PIE_SLICES - 1);
  const merged = rest.reduce(
    (acc, d) => ({ sum: acc.sum + d.sum, net: acc.net + (d.net ?? 0), count: acc.count + d.count }),
    { sum: 0, net: 0, count: 0 }
  );
  return [
    ...kept,
    {
      key: "Other",
      total: metricValue(merged, metric),
      sum: merged.sum,
      net: merged.net,
      count: merged.count,
      keys: rest.map((d) => d.key),
    },
  ];
}

// The coarsest bucket that still leaves a readable number of points for a
// span. The ladder used to stop at "month", which made a multi-year
// question either thousands of daily points or (post-fit) eighty monthly
// bars a few pixels wide.
export function granularityForSpan(days: number): "day" | "week" | "month" | "quarter" | "year" {
  if (days <= 21) return "day";
  if (days <= 120) return "week";
  if (days <= 3 * 365) return "month";
  if (days <= 8 * 365) return "quarter";
  return "year";
}

// Bars for a handful of discrete buckets, a line once the buckets are a
// trend. Matches the rule the system prompt follows, so a spec the model
// wrote and a spec resolved here look the same.
export function chartTypeForGranularity(granularity: string): "bar" | "line" {
  return granularity === "day" || granularity === "week" ? "bar" : "line";
}

export function spanDays(rows: Transaction[]): number {
  if (rows.length === 0) return 0;
  let min = rows[0].Date;
  let max = rows[0].Date;
  for (const r of rows) {
    if (r.Date < min) min = r.Date;
    if (r.Date > max) max = r.Date;
  }
  const [y1, m1, d1] = min.split("-").map(Number);
  const [y2, m2, d2] = max.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// The spec the chart is actually drawn from, which is not always the one
// the model returned.
//
// "How much did I spend at Chipotle?" names no category and no date
// range, so the model classifies it as a single-number question and
// groups by category -- and every matching row shares one category, so
// the chart is ONE bar holding six years of spending. That bar is
// arithmetically right and says nothing: no trend, no frequency, not even
// the span it covers.
//
// So: when a grouping collapses to a single bucket, re-group it over time
// at whatever granularity the matching rows actually span. The same
// question then answers itself as a monthly line, and the total moves to
// the stat line above the chart where a single number belongs.
export function resolveSpec(filteredRows: Transaction[], spec: QuerySpec | null): QuerySpec | null {
  if (!spec || !spec.groupBy || spec.groupBy === "none" || spec.groupBy === "transaction") return spec;
  // One transaction has no trend to expose -- the stat line above the
  // chart already says everything a re-grouping could.
  if (filteredRows.length < 2) return spec;

  const buckets = new Set(filteredRows.map((d) => groupKeyOf(spec, d)));
  if (buckets.size > 1) return spec;

  const granularity = granularityForSpan(spanDays(filteredRows));
  // Already as fine as the data allows -- a single day of transactions
  // has no time structure left to expose.
  if (granularity === spec.groupBy) return spec;

  return { ...spec, groupBy: granularity, chartType: chartTypeForGranularity(granularity) };
}

// Everything the stat line above the chart reports. Computed from the
// filtered rows rather than the chart buckets so a capped ranking (top 10
// merchants) still describes the whole matching set.
export type QuerySummary = {
  sum: number;
  count: number;
  average: number;
  perMonth: number;
  start: string;
  end: string;
  months: number;
};

export function summarize(filteredRows: Transaction[]): QuerySummary | null {
  if (filteredRows.length === 0) return null;
  let sum = 0;
  let start = filteredRows[0].Date;
  let end = filteredRows[0].Date;
  for (const d of filteredRows) {
    sum += Math.abs(d.Amount);
    if (d.Date < start) start = d.Date;
    if (d.Date > end) end = d.Date;
  }
  // Inclusive of both ends: a single day is one month's worth for the
  // purposes of a per-month rate, not zero (which would divide by it).
  const months = Math.max(spanDays(filteredRows) / 30.44, 1);
  return {
    sum,
    count: filteredRows.length,
    average: sum / filteredRows.length,
    perMonth: sum / months,
    start,
    end,
    months,
  };
}

// "Did I spend more this month than last?" -- one spec describes one
// window, so the comparison is made by re-running the same filter over
// the equal-length window immediately before it. The window comes from
// the spec's own bounds when it has them and from the matching rows
// otherwise, so an unbounded question still compares like for like.
export type Comparison = { sum: number; count: number; start: string; end: string; deltaPct: number | null };

export function comparePrevious(
  allRows: Transaction[],
  spec: QuerySpec | null,
  current: QuerySummary | null
): Comparison | null {
  if (!spec || spec.compareTo !== "previous" || !current) return null;

  const end = spec.dateEnd && isIsoDateish(spec.dateEnd) ? spec.dateEnd : current.end;
  const start = spec.dateStart && isIsoDateish(spec.dateStart) ? spec.dateStart : current.start;
  const length = daysBetween(start, end);
  // A window has to have length before "the one before it" means
  // anything.
  if (length < 1) return null;

  const previousEnd = daysBefore(start, 1);
  const previousStart = daysBefore(previousEnd, length);
  const rows = filterTransactions(allRows, { ...spec, dateStart: previousStart, dateEnd: previousEnd });
  const previous = summarize(rows);
  if (!previous) return { sum: 0, count: 0, start: previousStart, end: previousEnd, deltaPct: null };

  return {
    sum: previous.sum,
    count: previous.count,
    start: previousStart,
    end: previousEnd,
    // Undefined rather than infinite when the previous window is empty:
    // "up 100%" from nothing is not a fact about spending.
    deltaPct: previous.sum > 0 ? (current.sum - previous.sum) / previous.sum : null,
  };
}

const isIsoDateish = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// What a question about subscriptions is really asking: which payees
// bill on a regular cadence for a stable amount. Regularity is a
// property of a payee's whole history, not of any one row, so this
// cannot be expressed as a filter field -- it runs over the matching set
// and narrows it afterwards.
export type Recurring = {
  payee: string;
  cadence: "weekly" | "monthly" | "yearly";
  amount: number;
  count: number;
  lastDate: string;
  perMonth: number;
};

// Windows around the cadences a bill actually arrives on: monthly is
// wide because "the 1st" drifts across weekends and month lengths.
const CADENCES: { cadence: Recurring["cadence"]; min: number; max: number; perMonth: number }[] = [
  { cadence: "weekly", min: 5, max: 9, perMonth: 30.44 / 7 },
  { cadence: "monthly", min: 25, max: 38, perMonth: 1 },
  { cadence: "yearly", min: 345, max: 385, perMonth: 1 / 12 },
];

// Three charges is the fewest that can establish an interval at all: two
// give one gap, which is indistinguishable from a coincidence.
const MIN_CHARGES = 3;
// A subscription's amount moves (tax, tier changes), but not by much.
const AMOUNT_TOLERANCE = 0.2;

export function recurringPayees(rows: Transaction[]): Recurring[] {
  const byPayee: Record<string, Transaction[]> = {};
  for (const r of rows) {
    const key = r.Payee.trim().toLowerCase();
    (byPayee[key] ||= []).push(r);
  }

  const found: Recurring[] = [];
  for (const group of Object.values(byPayee)) {
    if (group.length < MIN_CHARGES) continue;
    const dates = group.map((r) => r.Date).sort();
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const typicalGap = median(gaps);
    const match = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max);
    if (!match) continue;
    // The median alone is not regularity: a merchant visited on the 3rd,
    // 4th, 19th, then not for six weeks has gaps of 1, 15, 39, 2 -- whose
    // median is 8.5, squarely "weekly". Most of the gaps have to sit in
    // the cadence's own window before this is a bill rather than a habit.
    const onCadence = gaps.filter((g) => g >= match.min && g <= match.max).length;
    if (onCadence / gaps.length < 0.6) continue;

    const amountsSeen = group.map((r) => Math.abs(r.Amount));
    const typicalAmount = median(amountsSeen);
    if (typicalAmount <= 0) continue;
    // Most of the charges have to sit near that amount -- otherwise this
    // is a merchant visited regularly, not a subscription.
    const steady = amountsSeen.filter((a) => Math.abs(a - typicalAmount) / typicalAmount <= AMOUNT_TOLERANCE);
    if (steady.length / amountsSeen.length < 0.6) continue;

    found.push({
      payee: group[0].Payee,
      cadence: match.cadence,
      amount: typicalAmount,
      count: group.length,
      lastDate: dates[dates.length - 1],
      perMonth: typicalAmount * match.perMonth,
    });
  }

  return found.sort((a, b) => b.perMonth - a.perMonth);
}

export function filterRecurring(rows: Transaction[], spec: QuerySpec | null): Transaction[] {
  if (!spec?.recurringOnly) return rows;
  const keep = new Set(recurringPayees(rows).map((r) => r.payee.trim().toLowerCase()));
  return rows.filter((r) => keep.has(r.Payee.trim().toLowerCase()));
}

// Spending measured against a number the question named. Pace compares
// how much of the budget is gone with how much of the window is, so
// "62% spent" reads differently on day 3 than on day 25.
export type BudgetProgress = { spent: number; target: number; pct: number; elapsedPct: number | null };

export function budgetProgress(summary: QuerySummary | null, spec: QuerySpec | null): BudgetProgress | null {
  if (!summary || !spec?.target || spec.target <= 0) return null;

  let elapsedPct: number | null = null;
  if (spec.dateStart && spec.dateEnd && isIsoDateish(spec.dateStart) && isIsoDateish(spec.dateEnd)) {
    const window = daysBetween(spec.dateStart, spec.dateEnd);
    if (window > 0) {
      const elapsed = daysBetween(spec.dateStart, summary.end);
      elapsedPct = Math.min(Math.max(elapsed / window, 0), 1);
    }
  }

  return { spent: summary.sum, target: spec.target, pct: summary.sum / spec.target, elapsedPct };
}

// A period whose total is really one purchase wearing a trend's clothes.
// Verified against real data: a single $170,000 Investments row sits in
// one month of an otherwise ~$14,000/month ledger, so the honest reading
// of that chart is "one transaction", not "spending tripled".
export type Outlier = { share: number; rows: number; payee: string; amount: number };

const OUTLIER_SHARE = 0.4;

export function findOutlier(filteredRows: Transaction[]): Outlier | null {
  if (filteredRows.length < 4) return null;
  const sorted = filteredRows.slice().sort((a, b) => Math.abs(b.Amount) - Math.abs(a.Amount));
  const total = sorted.reduce((acc, d) => acc + Math.abs(d.Amount), 0);
  if (total <= 0) return null;

  const biggest = Math.abs(sorted[0].Amount);
  if (biggest / total >= OUTLIER_SHARE) {
    return { share: biggest / total, rows: 1, payee: sorted[0].Payee, amount: biggest };
  }
  // Not one row, but a handful still standing in for most of the total.
  const topThree = sorted.slice(0, 3).reduce((acc, d) => acc + Math.abs(d.Amount), 0);
  if (sorted.length > 3 && topThree / total >= 0.6) {
    return { share: topThree / total, rows: 3, payee: sorted[0].Payee, amount: topThree };
  }
  return null;
}

export type QueryResult =
  | { error: string }
  | { offTopic: true }
  // `issues` names anything the model asked for that the app refused to
  // run -- an unreadable date, an unknown grouping, an absurd limit. It
  // is rendered on the card, because a dropped filter changes the answer
  // and a silently-changed answer is the failure mode worth avoiding.
  | { spec: QuerySpec; issues: string[] };

// Interprets the `query` Edge Function's response into exactly one of
// {error}/{offTopic}/{spec}.
export function parseQueryResponse(ok: boolean, data: any): QueryResult {
  if (!ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.error?.message || data?.error?.message || "Request failed";
    return { error: message };
  }

  const textBlock = (data.content || []).find((b: any) => b.type === "text");
  if (!textBlock) {
    return { error: "Claude did not return a text response." };
  }

  const raw = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.isLedgerQuery === false) return { offTopic: true };
    // Never trust the parsed object as a spec: normalizeSpec is what
    // stands between a model typo and a card that silently answers a
    // different question (see lib/specSchema.ts).
    return normalizeSpec(parsed);
  } catch (e: any) {
    return { error: String(e.message || e) };
  }
}
