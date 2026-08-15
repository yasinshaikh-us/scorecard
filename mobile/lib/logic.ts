// Ported from /src/logic.js -- same pure filter/group/parse logic the web
// app uses, kept behaviorally identical (including comments explaining
// the non-obvious parts) so the two clients answer the same question the
// same way. No React Native dependencies here -- this is the same file
// content-wise as the web version, just typed.

import type { Transaction } from "./types";
import { fmtDate } from "./format";

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
  groupBy?: "category" | "day" | "week" | "month" | "payee" | "account" | "transaction" | "none";
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
export type ChartDatum = { key: string; total: number; count: number; category?: string; row?: Transaction };

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
  // exactly this ranked/capped set.
  if (spec.groupBy === "transaction") {
    const arr = filteredRows.map((d) => ({
      key: groupKeyOf(spec, d),
      total: Math.abs(d.Amount),
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
    if (!map[k]) map[k] = { key: k, total: 0, count: 0 };
    map[k].total += Math.abs(d.Amount);
    map[k].count += 1;

    const cat = topCategory(d.Category);
    if (!categoryTotals[k]) categoryTotals[k] = {};
    categoryTotals[k][cat] = (categoryTotals[k][cat] || 0) + Math.abs(d.Amount);
  });
  for (const k of Object.keys(map)) {
    const totals = categoryTotals[k];
    map[k].category = Object.keys(totals).reduce((best, cat) => (totals[cat] > totals[best] ? cat : best));
  }
  let arr = Object.values(map);
  if (spec.groupBy === "day" || spec.groupBy === "week" || spec.groupBy === "month") {
    arr.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    arr.sort((a, b) => b.total - a.total);
    const defaultCap = spec.groupBy === "payee" ? 10 : null;
    const cap = spec.limit || defaultCap;
    if (cap && arr.length > cap) arr = arr.slice(0, cap);
  }
  return arr;
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
