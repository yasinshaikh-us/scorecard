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
