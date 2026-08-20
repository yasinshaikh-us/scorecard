// Everything the app is willing to believe about the JSON the `query`
// Edge Function's model returns.
//
// The spec used to be handed straight from JSON.parse into the filter,
// with no check of any kind, and the failure that mattered was silent:
// a model that answered "last month" with dateStart "yesterday" instead
// of an ISO date filtered out EVERY row -- because the filter compares
// dates as strings, and every "2026-…" sorts below every "y…". The card
// then said "No matching transactions", which reads as an answer rather
// than a fault. A clamped spec plus a visible note about what was
// dropped is the difference between a wrong answer and a reported one.
//
// Nothing here is a security boundary: the prompt is built server-side,
// the ledger is RLS-scoped to the caller, and the spec only ever filters
// rows the client already holds. This is about a malformed spec never
// masquerading as an empty result.

import type { QuerySpec } from "./logic";

const CHART_TYPES = ["bar", "pie", "line", "none"] as const;
const GROUP_BYS = [
  "category",
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "payee",
  "account",
  "transaction",
  "none",
] as const;
const TYPES = ["expense", "income", "transfer", "all"] as const;
const METRICS = ["sum", "count", "avg", "net", "median"] as const;
// Deliberately narrow: a second dimension is only readable across a
// handful of values, and these are the fields that have them.
const SERIES_BYS = ["category", "account", "payee"] as const;

// A ranking is drawn as one row or bar per entry, so a limit past this is
// not a chart anyone reads -- and the model can emit any integer.
const MAX_LIMIT = 50;
// Long enough for a real title, short enough that a runaway string can't
// take over the card.
const MAX_TITLE = 80;
// A filter substring is a merchant or category fragment, not an essay.
const MAX_CONTAINS = 100;

export type SpecIssue = string;

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : null;
}

// ISO, and a real calendar date: "2026-02-31" parses as a string but is
// not a day, and would quietly filter to nothing.
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// A list of category names. A bare string is accepted as a one-element
// list, since that is the shape a model most often gets wrong.
function stringList(value: unknown): string[] | null {
  const raw = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!raw) return null;
  const cleaned = raw.map((v) => cleanString(v, MAX_CONTAINS)).filter((v): v is string => v !== null);
  return cleaned.length ? cleaned : null;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Returns the spec the app will actually run, plus a plain-language list
// of what was ignored. The issues are rendered on the card: a dropped
// filter changes the answer, so it has to be visible.
export function normalizeSpec(raw: any): { spec: QuerySpec; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    issues.push("the answer wasn't a query, so nothing was filtered");
  }

  const spec: QuerySpec = {};

  const chartType = oneOf(input.chartType, CHART_TYPES);
  if (input.chartType != null && !chartType) issues.push(`unknown chart type "${String(input.chartType).slice(0, 20)}"`);
  spec.chartType = chartType || "bar";

  const groupBy = oneOf(input.groupBy, GROUP_BYS);
  if (input.groupBy != null && !groupBy) issues.push(`unknown grouping "${String(input.groupBy).slice(0, 20)}"`);
  spec.groupBy = groupBy || "category";

  const type = oneOf(input.type, TYPES);
  if (input.type != null && !type) issues.push(`unknown transaction type "${String(input.type).slice(0, 20)}"`);
  spec.type = type || "all";

  const metric = oneOf(input.metric, METRICS);
  if (input.metric != null && !metric) issues.push(`unknown metric "${String(input.metric).slice(0, 20)}"`);
  spec.metric = metric || "sum";

  // Dates are dropped rather than kept-and-ignored: a bad bound that
  // stays in the spec is exactly the silent-empty-result case.
  for (const field of ["dateStart", "dateEnd"] as const) {
    if (input[field] == null) continue;
    if (isIsoDate(input[field])) spec[field] = input[field];
    else issues.push(`ignored an unreadable ${field === "dateStart" ? "start" : "end"} date`);
  }
  if (spec.dateStart && spec.dateEnd && spec.dateStart > spec.dateEnd) {
    [spec.dateStart, spec.dateEnd] = [spec.dateEnd, spec.dateStart];
    issues.push("the date range was backwards, so it was flipped");
  }

  spec.categories = stringList(input.categories);
  spec.excludeCategories = stringList(input.excludeCategories);
  spec.categoryContains = cleanString(input.categoryContains, MAX_CONTAINS);
  spec.payeeContains = cleanString(input.payeeContains, MAX_CONTAINS);
  spec.payeeAny = stringList(input.payeeAny);
  spec.accountContains = cleanString(input.accountContains, MAX_CONTAINS);
  spec.title = cleanString(input.title, MAX_TITLE) || undefined;

  spec.includeTransfers = input.includeTransfers === true;
  spec.recurringOnly = input.recurringOnly === true;
  spec.forecast = input.forecast === true;

  const seriesBy = oneOf(input.seriesBy, SERIES_BYS);
  if (input.seriesBy != null && !seriesBy) issues.push(`can't split by "${String(input.seriesBy).slice(0, 20)}"`);
  // Splitting a dimension by itself is one dimension, not two.
  spec.seriesBy = seriesBy && seriesBy !== spec.groupBy ? seriesBy : null;
  spec.compareTo = input.compareTo === "previous" ? "previous" : null;

  // A budget of zero or less is not a target anyone set.
  const target = finiteNumber(input.target);
  if (input.target != null && (target === null || target <= 0)) issues.push("ignored an unusable budget target");
  spec.target = target !== null && target > 0 ? target : null;

  const min = finiteNumber(input.amountMin);
  const max = finiteNumber(input.amountMax);
  if (input.amountMin != null && min === null) issues.push("ignored an unreadable minimum amount");
  if (input.amountMax != null && max === null) issues.push("ignored an unreadable maximum amount");
  // Magnitudes: the filter compares against Math.abs(Amount), so a
  // negative bound would match everything or nothing depending on which
  // end it landed on.
  spec.amountMin = min !== null ? Math.abs(min) : null;
  spec.amountMax = max !== null ? Math.abs(max) : null;
  if (spec.amountMin != null && spec.amountMax != null && spec.amountMin > spec.amountMax) {
    [spec.amountMin, spec.amountMax] = [spec.amountMax, spec.amountMin];
    issues.push("the amount range was backwards, so it was flipped");
  }

  const limit = finiteNumber(input.limit);
  if (limit === null) {
    spec.limit = null;
  } else {
    const clamped = Math.min(Math.max(Math.round(limit), 1), MAX_LIMIT);
    if (clamped !== Math.round(limit)) issues.push(`a limit of ${Math.round(limit)} was capped to ${clamped}`);
    spec.limit = clamped;
  }

  return { spec, issues };
}
