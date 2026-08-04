// Pure data/query logic shared by App.jsx, extracted so it can be unit
// tested without rendering React. No React or DOM dependencies here.

export const topCategory = (cat) => (cat || "Uncategorized").split(":")[0];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Filters out rows missing a required field and coerces types into a
// clean {Date, Payee, Category, Amount, Account, IsTransfer} shape. The
// one place this happens, shared by every consumer of raw transaction
// rows (the client's own fetch handler in App.jsx, and api/query.js's
// separate server-side re-fetch for building its system prompt) so they
// can't independently drift out of sync -- a row with a missing/null
// Category was previously silently dropped on the client but crashed
// api/query.js's computeDataMeta call, since only the client applied
// this filter.
export function cleanRows(rows) {
  return rows
    .filter((r) => r.Date && r.Payee && r.Category && r.Amount !== undefined && r.Amount !== null && !isNaN(r.Amount))
    .map((r) => ({
      Date: String(r.Date).trim(),
      Payee: String(r.Payee).trim(),
      Category: String(r.Category).trim(),
      Amount: Number(r.Amount),
      Account: r.Account ? String(r.Account).trim() : "Manual entry",
      IsTransfer: !!r.IsTransfer,
    }));
}

// Computes the derived lookups the rest of the app (and the system prompt)
// rely on from a flat array of {Date, Payee, Category, Amount} rows.
export function computeDataMeta(rows) {
  const CATS = [...new Set(rows.map((d) => topCategory(d.Category)))];
  const SUBCATS = [...new Set(rows.map((d) => d.Category.trim()))].sort();
  let MIN_DATE = "";
  let MAX_DATE = "";
  if (rows.length) {
    MIN_DATE = rows.reduce((a, d) => (d.Date < a ? d.Date : a), rows[0].Date);
    MAX_DATE = rows.reduce((a, d) => (d.Date > a ? d.Date : a), rows[0].Date);
  }
  return { CATS, SUBCATS, MIN_DATE, MAX_DATE };
}

// N days before a YYYY-MM-DD date, as a YYYY-MM-DD string. Computed via
// UTC-anchored arithmetic (Date.UTC), never a locally-parsed Date -- see
// groupKeyOf's "week" case for why a local-midnight round trip silently
// shifts the result by a day in positive-UTC-offset timezones. Anchored
// to the data's own latest date rather than the runtime's real "now", so
// "recent" means recent within the ledger even if it hasn't synced today.
export function daysBefore(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export const fmtDate = (iso) => {
  if (typeof iso !== "string" || !iso.includes("-")) return iso == null ? "" : String(iso);
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi] || isNaN(parseInt(d, 10))) return iso;
  const yy = y.slice(-2);
  return `${parseInt(d, 10)} ${MONTHS[mi]} ${yy}`;
};

export const fmtMonth = (ym) => {
  if (typeof ym !== "string" || !ym.includes("-")) return ym == null ? "" : String(ym);
  const [y, m] = ym.split("-");
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi]) return ym;
  return `${MONTHS[mi]} ${y.slice(-2)}`;
};

export const isDateKey = (groupBy) => groupBy === "day" || groupBy === "week" || groupBy === "month";
export const fmtGroupKey = (k, groupBy) => (groupBy === "month" ? fmtMonth(k) : isDateKey(groupBy) ? fmtDate(k) : k);

export const fmtMoney = (n) => {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Applies a query spec's filter fields ({categories, categoryContains,
// payeeContains, accountContains, dateStart, dateEnd, type,
// includeTransfers, amountMin, amountMax}) to a rows array.
//
// IsTransfer rows (internal transfers between the user's own linked
// accounts, e.g. savings -> checking) are excluded by default, not just
// when type is "expense"/"income": once a person has more than one
// account, a transfer shows up as an expense row on one account and an
// income row on the other, so leaving it in would double-count it in any
// "all" or unfiltered total too. spec.type === "transfer" or
// spec.includeTransfers === true opt back in for questions that are
// actually about the transfers themselves.
export function filterTransactions(rows, spec) {
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
export function groupKeyOf(spec, d) {
  if (!spec) return "";
  if (spec.groupBy === "category") return topCategory(d.Category);
  if (spec.groupBy === "payee") return d.Payee;
  if (spec.groupBy === "account") return d.Account || "Manual entry";
  // "transaction" ranks individual rows rather than summing them into a
  // group (see buildChartData) -- the key doubles as the bar's label, so
  // it's the payee + date rather than a bare id. Two transactions can
  // collide here (same payee, same day) and get treated as one selection
  // group if clicked; accepted as a rare, non-corrupting edge case rather
  // than threading a synthetic per-row id through every call site.
  if (spec.groupBy === "transaction") return `${d.Payee} — ${fmtDate(d.Date)}`;
  if (spec.groupBy === "day") return d.Date;
  if (spec.groupBy === "month") return d.Date.slice(0, 7);
  if (spec.groupBy === "week") {
    // Computed entirely in UTC-anchored arithmetic (Date.UTC + getUTCDay),
    // never through a locally-parsed Date or toISOString() round trip —
    // that used to parse d.Date as local midnight and convert the result
    // back to UTC, which silently shifted the computed week-start back a
    // day for viewers in positive-UTC-offset timezones.
    const [y, m, day] = d.Date.split("-").map(Number);
    const utcMs = Date.UTC(y, m - 1, day);
    const dayOfWeek = new Date(utcMs).getUTCDay();
    return new Date(utcMs - dayOfWeek * 86400000).toISOString().slice(0, 10);
  }
  return "";
}

// Builds the {key, total, count} chart series from already-filtered rows:
// groups by groupKeyOf, sorts chronologically for date-based groupings
// (descending total otherwise), and caps merchant/transaction rankings to
// spec.limit (defaulting to 10 when the question didn't name a count) so
// the chart never renders an unbounded list. Category/account rankings
// are only capped when the question explicitly asked for a count -- the
// category set is small and closed, so no default cap has ever been
// needed there.
export function buildChartData(filteredRows, spec) {
  if (!spec || spec.groupBy === "none") return [];

  // Ranks individual transactions by size rather than summing them into
  // groups -- each row stays its own entry (see groupKeyOf's collision
  // note above), so this bypasses the group-and-sum map below entirely.
  if (spec.groupBy === "transaction") {
    // `row` carries the original transaction back to the caller (see
    // QueryCard.jsx's sortedRows) so the list below the chart can show
    // exactly this ranked/capped set instead of an unrelated date-sorted
    // browse of every matching transaction.
    let arr = filteredRows.map((d) => ({ key: groupKeyOf(spec, d), total: Math.abs(d.Amount), count: 1, row: d }));
    arr.sort((a, b) => b.total - a.total);
    const cap = spec.limit || 10;
    return arr.slice(0, cap);
  }

  const map = {};
  filteredRows.forEach((d) => {
    const k = groupKeyOf(spec, d);
    if (!map[k]) map[k] = { key: k, total: 0, count: 0 };
    map[k].total += Math.abs(d.Amount);
    map[k].count += 1;
  });
  let arr = Object.values(map);
  if (isDateKey(spec.groupBy)) {
    arr.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    arr.sort((a, b) => b.total - a.total);
    const defaultCap = spec.groupBy === "payee" ? 10 : null;
    const cap = spec.limit || defaultCap;
    if (cap && arr.length > cap) arr = arr.slice(0, cap);
  }
  return arr;
}

// Interprets the /api/query response into exactly one of
// {error}/{offTopic}/{spec} — pulled out of App.jsx so the "did the
// request actually fail" branch is unit-testable. Previously that check
// didn't exist at all: any non-2xx response (an expired token, a
// downstream Anthropic/Supabase failure, ...) still fell through to
// parsing `data.content` as if it were a successful Claude reply, which
// is undefined on an error body — producing a "Couldn't parse that one"
// card with a "JSON.parse('')" error message that had nothing to do
// with what actually went wrong.
export function parseQueryResponse(ok, data) {
  if (!ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.error?.message || data?.error?.message || "Request failed";
    return { error: message };
  }

  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) {
    return { error: "Claude did not return a text response." };
  }

  const raw = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed.isLedgerQuery === false ? { offTopic: true } : { spec: parsed };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}
