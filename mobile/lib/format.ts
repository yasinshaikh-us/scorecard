// Ported from /src/logic.js -- same pure date/money formatting the web app
// uses, kept identical so the two clients read a date/amount the same way.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function daysBefore(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDate(iso: string) {
  if (typeof iso !== "string" || !iso.includes("-")) return iso == null ? "" : String(iso);
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  const [y, m, d] = parts;
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi] || isNaN(parseInt(d, 10))) return iso;
  const yy = y.slice(-2);
  return `${parseInt(d, 10)} ${MONTHS[mi]} ${yy}`;
}

export function fmtMoney(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtMonth(ym: string) {
  if (typeof ym !== "string" || !ym.includes("-")) return ym == null ? "" : String(ym);
  const [y, m] = ym.split("-");
  const mi = parseInt(m, 10) - 1;
  if (!MONTHS[mi]) return ym;
  return `${MONTHS[mi]} ${y.slice(-2)}`;
}

// "2026-Q3" -> "Q3 26". Quarters exist so a multi-year span has a bucket
// coarser than a month without jumping straight to one point per year.
export function fmtQuarter(q: string) {
  if (typeof q !== "string" || !q.includes("-Q")) return q == null ? "" : String(q);
  const [y, quarter] = q.split("-Q");
  if (!/^[1-4]$/.test(quarter)) return q;
  return `Q${quarter} ${y.slice(-2)}`;
}

export function isDateKey(groupBy: string) {
  return groupBy === "day" || groupBy === "week" || groupBy === "month" || groupBy === "quarter" || groupBy === "year";
}

export function fmtGroupKey(k: string, groupBy: string) {
  if (groupBy === "year") return k;
  if (groupBy === "quarter") return fmtQuarter(k);
  if (groupBy === "month") return fmtMonth(k);
  return isDateKey(groupBy) ? fmtDate(k) : k;
}
