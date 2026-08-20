// Ported from /src/logic.js -- same pure filter/group/parse logic the web
// app uses, kept behaviorally identical (including comments explaining
// the non-obvious parts) so the two clients answer the same question the
// same way. No React Native dependencies here -- this is the same file
// content-wise as the web version, just typed.

import type { Transaction } from "./types";
import { fmtDate, isDateKey } from "./format";

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
  metric?: "sum" | "count" | "avg";
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
  filteredRows.forEach((d) => {
    const k = groupKeyOf(spec, d);
    if (!map[k]) map[k] = { key: k, total: 0, sum: 0, count: 0 };
    map[k].sum += Math.abs(d.Amount);
    map[k].count += 1;

    const cat = topCategory(d.Category);
    if (!categoryTotals[k]) categoryTotals[k] = {};
    categoryTotals[k][cat] = (categoryTotals[k][cat] || 0) + Math.abs(d.Amount);
  });
  for (const k of Object.keys(map)) {
    const totals = categoryTotals[k];
    map[k].category = Object.keys(totals).reduce((best, cat) => (totals[cat] > totals[best] ? cat : best));
    map[k].total = metricValue(map[k], spec.metric);
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

export function metricValue(d: { sum: number; count: number }, metric: QuerySpec["metric"]): number {
  if (metric === "count") return d.count;
  if (metric === "avg") return d.count > 0 ? d.sum / d.count : 0;
  return d.sum;
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
    (acc, d) => ({ sum: acc.sum + d.sum, count: acc.count + d.count }),
    { sum: 0, count: 0 }
  );
  return [
    ...kept,
    {
      key: "Other",
      total: metricValue(merged, metric),
      sum: merged.sum,
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

export type QueryResult = { error: string } | { offTopic: true } | { spec: QuerySpec };

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
    return parsed.isLedgerQuery === false ? { offTopic: true } : { spec: parsed };
  } catch (e: any) {
    return { error: String(e.message || e) };
  }
}
