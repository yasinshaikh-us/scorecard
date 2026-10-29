// Mirrors the SQL logic in apply_category_rules() / clean_payee() (see
// supabase/migrations/20260803010000_add_category_rules_engine.sql,
// 20260803030000_scrub_payee_junk.sql, and
// 20261029000000_transfer_category_and_amount_rules.sql) -- same semantics, kept in sync
// deliberately rather than shared, since one runs in Postgres (bulk
// retroactive re-apply) and this one runs per transaction during the live
// sync. Case-insensitive "contains" match; rules apply in ascending
// priority order, later matches overwrite earlier ones for whichever
// field they set. A rule with min_amount / max_amount (inclusive, signed:
// negative = money out) only matches amounts in that range; an
// "uncategorized" rule runs after the rest and the clamp, and only on a
// transaction still in "Miscellaneous".

export interface CategoryRule {
  match_field: "payee" | "category" | "uncategorized";
  match_value: string;
  set_category: string | null;
  set_payee: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
}

// Fixed, closed category set -- anything that isn't one of these after all
// rules run (no rule matched, or a rule set something outside the list)
// falls back to "Miscellaneous". Hardcoded for now, same as the SQL side.
const ALLOWED_CATEGORIES = new Set([
  "Income", "Mortgage", "Investments", "Rent", "Alimony", "Taxes", "Miscellaneous",
  "Dining", "Shopping", "Utilities", "Groceries", "Transport", "Education", "Health",
  "Cash", "Travel", "Software", "Entertainment", "Fees",
  "Insurance", "Home Services", "Personal Care",
  "Transfer",
]);

const US_STATE_ABBREVIATIONS =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

// Card processors that prefix the merchant name with "<CODE>*" (Toast,
// Square, Clover, ...). Stripped as a prefix -- the generic "*token" rule
// below would otherwise delete the merchant name right after the asterisk.
const POS_PREFIX = /^\s*(TST|SQ|SP|CKE|PAR|PY|DD|BT|IC|LS)\s*\*\s*/i;

// Two-word city names: the word before the city's last word is one of
// these, or its last word is one of the second set. Anything else is read
// as a one-word city.
const CITY_FIRST_WORDS =
  "North|South|East|West|Port|New|San|Santa|Los|Las|Fort|Mount|Mt|Saint|St|Lake|Federal|Mercer|Bainbridge|Gig|Maple|Mill|Mountlake|Battle|Sedro|Walla|Salt|Kansas|Jersey|Daly|Redwood";
const CITY_LAST_WORDS = "Island|Harbor|Valley|Terrace|City|Beach|Falls|Springs|Heights|Park|Point|Creek|Bend|Ridge|Hills|Canyon";

const CITY_STATE_TWO_WORD = new RegExp(
  `^(.*\\S)\\s+((?:${CITY_FIRST_WORDS})\\s+\\S+|\\S+\\s+(?:${CITY_LAST_WORDS}))\\s+(${US_STATE_ABBREVIATIONS})\\s*$`,
  "i"
);
const CITY_STATE_ONE_WORD = new RegExp(`^(.*\\S)\\s+(\\S+)\\s+(${US_STATE_ABBREVIATIONS})\\s*$`, "i");

// States that are also ordinary words at the end of a business name
// ("Drive In", "Acme Co"). For these only the 2-letter tail is dropped, as
// before -- the word in front of it is not assumed to be a city.
const AMBIGUOUS_STATES = new Set(["IN", "OR", "ME", "OK", "HI", "OH", "CO", "DE", "LA", "ID"]);

// Words that end a business name, never a city -- "Sea Airport Parking WA"
// has no city field, and "Parking" is not one.
const NOT_A_CITY = new Set([
  "parking", "svcs", "services", "service", "inc", "inc.", "llc", "pllc", "ltd", "co", "corp", "company",
  "store", "market", "mart", "cafe", "restaurant", "bar", "grill", "shop", "center", "clinic", "medical",
  "dental", "licensing", "online", "payment", "fee", "premium", "prep", "pharmacy", "food", "foods",
  "coffee", "pizza", "burger", "burgers", "salon", "spa", "studio", "hotel", "airlines", "insurance",
  "bank", "subscription", "membership",
]);

// Bank/card statement descriptors are frequently full of junk beyond just
// casing: processor prefixes, masked account numbers ("XX1234",
// "Xxx-xxx-6365"), transaction reference codes, phone numbers, ACH PPD/WEB
// ID numbers, URL fragments, long reference digit runs, store/terminal
// numbers and ZIP codes, and trailing "City ST MM/DD" geolocation. The goal
// is just the vendor's name. Heuristic-based, not perfect for every
// descriptor format -- deliberately leaves leading numeric store codes
// alone (e.g. "4761 Bellevue Bellevue"), since those are ambiguous rather
// than clearly junk the way a phone number or date is.
export function cleanPayee(raw: string): string {
  let result = raw;
  result = result.replace(POS_PREFIX, "");
  result = result.replace(/\*[a-zA-Z0-9]+/g, "");
  result = result.replace(/\bxx+\d+\b/gi, "");

  // "Online (Realtime) Transfer To/From <name> ..." boilerplate prefix --
  // strip it so the counterparty name that follows becomes the payee.
  result = result.replace(/^\s*(Online\s+)?(Realtime\s+)?Transfer\s+(To|From)\s+/i, "");

  // "Transaction#: <code>" / "Reference#: <code>" labeled junk, whether or
  // not a value follows -- label-based rather than trying to pattern-match
  // the reference code itself, since those mix digits and letters (e.g.
  // "9255370026RX") in ways the generic digit-run rule below can't
  // reliably catch (no word boundary between the digits and the letters).
  result = result.replace(/\bTransaction\s*#:?\s*[a-zA-Z0-9]*/gi, "");
  result = result.replace(/\bReference\s*#:?\s*[a-zA-Z0-9]*/gi, "");

  result = result.replace(/\s#(\s|$)/g, " ");
  result = result.replace(/\b(PPD|WEB|CCD|ARC)\s*ID:?\s*[A-Z]?\d+\b/gi, "");
  result = result.replace(/\s*\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\s*$/, "");
  // a phone number at the very end, before the trailing-number rule can
  // take it apart group by group
  result = result.replace(/\s*\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*$/, "");
  // trailing ZIP code / store or terminal number
  result = result.replace(/\s+#?\d{3,}\s*$/, "");

  // trailing "City ST" -- and the city again if the name already ended in
  // it ("Hmart - Bellevue Bellevue WA"). Runs before the phone/URL rules
  // because the descriptor's city slot often holds one of those instead
  // ("Amazon Kids+ 888-802-3080 WA"); stripping them first would make the
  // name's last word look like the city.
  let strippedCity = false;
  const cityState = result.match(CITY_STATE_TWO_WORD) || result.match(CITY_STATE_ONE_WORD);
  if (
    cityState &&
    !AMBIGUOUS_STATES.has(cityState[3].toUpperCase()) &&
    !NOT_A_CITY.has(cityState[2].toLowerCase())
  ) {
    const city = cityState[2];
    result = cityState[1];
    strippedCity = true;
    if (result.length > city.length + 1 && result.slice(-(city.length + 1)).toLowerCase() === " " + city.toLowerCase()) {
      result = result.slice(0, result.length - city.length - 1);
    }
  } else {
    result = result.replace(new RegExp(`\\s+(${US_STATE_ABBREVIATIONS})\\s*$`, "i"), "");
  }
  result = result.replace(/\s+#?\d{3,}\s*$/, "");

  result = result.replace(/\bhttps?\S*/gi, "");
  result = result.replace(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/g, "");
  result = result.replace(/\b\d{7,}\b/g, "");

  // masked numbers that survived the rules above ("Xxx-xxxx3212",
  // "Invxxxxx0207", "X5399"), phone fragments ("425-") and stray asterisks
  result = result.replace(/\S*xxx\S*/gi, "");
  result = result.replace(/\bX\d{3,}\b/gi, "");
  result = result.replace(/\s\d{3}-(\s|$)/g, " ");
  result = result.replace(/\*/g, "");

  result = result.replace(/\s+/g, " ").trim();
  // connector left dangling by the city removal ("Kanishka Cuisine Of",
  // "Hmart -") -- only then, so a name that really ends in one keeps it
  if (strippedCity) {
    result = result.replace(/(\s+(and|of|at|&|-|\/))+$/i, "");
  }
  result = result.trim();
  return result || raw;
}

// Must match Postgres initcap() exactly -- the SQL half of this engine
// (apply_category_rules) title-cases with initcap, and any difference here
// means the same payee renders differently depending on whether it was
// last touched by the live sync or by a retroactive rule re-apply.
//
// initcap's definition: words are runs of ALPHANUMERIC characters, and
// everything else separates them. The obvious JS spelling, `\b\w`, is
// subtly wrong for exactly one character: \w includes underscore, so JS
// sees no word boundary inside "foo_bar" while Postgres sees two words.
// That produced "Foo_bar" here against "Foo_Bar" in SQL -- caught by
// supabase/tests/categoryRulesParity.test.ts, which runs both against the
// same inputs. Hence the explicit [a-z0-9] class rather than \w.
function titleCase(str: string): string {
  return str.toLowerCase().replace(/(^|[^a-z0-9])([a-z0-9])/g, (_, separator, char) => separator + char.toUpperCase());
}

// Postgres numeric arrives from PostgREST as a string; Number() takes both.
function inAmountRange(rule: CategoryRule, amount: number) {
  if (rule.min_amount != null && amount < Number(rule.min_amount)) return false;
  if (rule.max_amount != null && amount > Number(rule.max_amount)) return false;
  return true;
}

export function applyCategoryRules(rawPayee: string, rawCategory: string, rules: CategoryRule[], amount: number) {
  let category = rawCategory;
  let payee = titleCase(cleanPayee(rawPayee));

  for (const rule of rules) {
    if (rule.match_field === "uncategorized") continue;
    const haystack = rule.match_field === "payee" ? rawPayee : rawCategory;
    if (!haystack.toLowerCase().includes(rule.match_value.toLowerCase())) continue;
    if (!inAmountRange(rule, amount)) continue;
    if (rule.set_category != null) category = rule.set_category;
    if (rule.set_payee != null) payee = rule.set_payee;
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    category = "Miscellaneous";
  }

  for (const rule of rules) {
    if (rule.match_field !== "uncategorized" || category !== "Miscellaneous") continue;
    if (!rawPayee.toLowerCase().includes(rule.match_value.toLowerCase())) continue;
    if (!inAmountRange(rule, amount)) continue;
    if (rule.set_category != null) category = rule.set_category;
    if (rule.set_payee != null) payee = rule.set_payee;
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    category = "Miscellaneous";
  }

  return { category, payee };
}
