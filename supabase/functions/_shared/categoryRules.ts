// Mirrors the SQL logic in apply_category_rules() / clean_payee() (see
// supabase/migrations/20260803010000_add_category_rules_engine.sql,
// 20260803030000_scrub_payee_junk.sql, and
// 20260803040000_closed_category_set.sql) -- same semantics, kept in sync
// deliberately rather than shared, since one runs in Postgres (bulk
// retroactive re-apply) and this one runs per transaction during the live
// sync. Case-insensitive "contains" match; rules apply in ascending
// priority order, later matches overwrite earlier ones for whichever
// field they set.

export interface CategoryRule {
  match_field: "payee" | "category";
  match_value: string;
  set_category: string | null;
  set_payee: string | null;
}

// Fixed, closed category set -- anything that isn't one of these after all
// rules run (no rule matched, or a rule set something outside the list)
// falls back to "Miscellaneous". Hardcoded for now, same as the SQL side.
const ALLOWED_CATEGORIES = new Set([
  "Income", "Mortgage", "Investments", "Rent", "Alimony", "Taxes", "Miscellaneous",
  "Dining", "Shopping", "Utilities", "Groceries", "Transport", "Education", "Health",
  "Cash", "Travel", "Software", "Entertainment", "Fees",
]);

const US_STATE_ABBREVIATIONS =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

// Bank/card statement descriptors are frequently full of junk beyond just
// casing: masked account suffixes, transaction reference codes, phone
// numbers, ACH PPD/WEB ID numbers, long reference digit runs, trailing
// city/state, and trailing MM/DD dates. Heuristic-based, not perfect for
// every descriptor format -- deliberately leaves leading numeric store
// codes alone (e.g. "4761 Bellevue Bellevue"), since those are ambiguous
// rather than clearly junk the way a phone number or date is.
export function cleanPayee(raw: string): string {
  let result = raw;
  result = result.replace(/\*[a-zA-Z0-9]+/g, "");
  result = result.replace(/\bxx+\d+\b/gi, "");
  result = result.replace(/\s#(\s|$)/g, " ");
  result = result.replace(/\b(PPD|WEB|CCD|ARC)\s*ID:?\s*\d+\b/gi, "");
  result = result.replace(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/g, "");
  result = result.replace(/\b\d{7,}\b/g, "");
  result = result.replace(/\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, "");
  result = result.replace(new RegExp(`\\s+(${US_STATE_ABBREVIATIONS})\\s*$`, "i"), "");
  result = result.replace(/\s+/g, " ").trim();
  return result || raw;
}

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function applyCategoryRules(rawPayee: string, rawCategory: string, rules: CategoryRule[]) {
  let category = rawCategory;
  let payee = titleCase(cleanPayee(rawPayee));

  for (const rule of rules) {
    const haystack = rule.match_field === "payee" ? rawPayee : rawCategory;
    if (!haystack.toLowerCase().includes(rule.match_value.toLowerCase())) continue;
    if (rule.set_category != null) category = rule.set_category;
    if (rule.set_payee != null) payee = rule.set_payee;
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    category = "Miscellaneous";
  }

  return { category, payee };
}
