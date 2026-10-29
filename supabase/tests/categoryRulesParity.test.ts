import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { cleanPayee, applyCategoryRules, type CategoryRule } from "../functions/_shared/categoryRules.ts";

// The category engine exists TWICE, on purpose:
//
//   * categoryRules.ts   -- runs per transaction during the live Plaid
//                           sync (inside syncItemTransactions).
//   * clean_payee() +    -- runs in bulk, retroactively, whenever the user
//     apply_category_rules()  adds/toggles/deletes a rule in the Rules panel.
//
// categoryRules.ts's own header says they are "kept in sync deliberately
// rather than shared". Nothing enforced that. This file does: it runs the
// SAME inputs through both implementations and asserts identical output.
//
// Why it matters concretely: a user adds a rule, the Rules panel re-applies
// it retroactively via SQL, and their historical rows get one answer. The
// next Plaid sync then processes new rows through the TypeScript path. If
// the two disagree, the same merchant is categorized one way in old rows
// and another way in new ones, and the ledger quietly becomes inconsistent
// with no error anywhere.
//
// Requires a Postgres with the migrations applied (supabase/tests/run.sh
// builds exactly that). Skipped when DATABASE_URL is unset, so a plain
// `npm test` on a laptop with no database still passes.

const DATABASE_URL = process.env.DATABASE_URL;
const USER_ID = "11111111-1111-1111-1111-111111111111";

interface ParityCase {
  name: string;
  rawPayee: string;
  rawCategory: string;
  amount?: number;
  rules?: CategoryRule[];
}

function rule(partial: Partial<CategoryRule>): CategoryRule {
  return { match_field: "payee", match_value: "", set_category: null, set_payee: null, ...partial };
}

// Descriptors chosen to exercise each scrubbing rule, plus the shapes
// where the two languages could plausibly diverge: initcap vs a JS regex
// for title-casing, and ILIKE vs String.includes for rule matching.
const CASES: ParityCase[] = [
  { name: "plain descriptor", rawPayee: "BLUE BOTTLE COFFEE", rawCategory: "Dining" },
  { name: "square-style star token", rawPayee: "SQ *COFFEE BAR", rawCategory: "Dining" },
  { name: "masked account suffix", rawPayee: "AMEX EPAYMENT XX1234", rawCategory: "Fees" },
  { name: "transfer prefix", rawPayee: "Online Transfer To Jane Doe", rawCategory: "Miscellaneous" },
  { name: "realtime transfer prefix", rawPayee: "Online Realtime Transfer From Jane Doe", rawCategory: "Income" },
  { name: "transaction reference label", rawPayee: "ACME INC Transaction#: 9255370026RX", rawCategory: "Shopping" },
  { name: "reference label", rawPayee: "ACME INC Reference#: ABC123", rawCategory: "Shopping" },
  { name: "ACH entry class id", rawPayee: "PAYROLL DEP PPD ID: 1234567890", rawCategory: "Income" },
  { name: "phone number", rawPayee: "SUPPORT LINE 800-555-1234", rawCategory: "Utilities" },
  { name: "long digit run", rawPayee: "STORE 1234567", rawCategory: "Shopping" },
  { name: "trailing store number", rawPayee: "STORE 123456", rawCategory: "Shopping" },
  { name: "trailing date", rawPayee: "ACME INC 07/14", rawCategory: "Shopping" },
  { name: "trailing date with year", rawPayee: "ACME INC 07/14/2026", rawCategory: "Shopping" },
  { name: "trailing state", rawPayee: "BLUE BOTTLE SEATTLE WA", rawCategory: "Dining" },
  { name: "trailing CO read as Colorado", rawPayee: "ACME CO", rawCategory: "Shopping" },
  { name: "leading store code", rawPayee: "4761 Bellevue Bellevue", rawCategory: "Shopping" },
  { name: "scrubs to empty, falls back to raw", rawPayee: "XX1234", rawCategory: "Fees" },
  { name: "collapsing whitespace", rawPayee: "ACME   INC    XX99", rawCategory: "Shopping" },
  { name: "hash separator", rawPayee: "ACME INC # 12", rawCategory: "Shopping" },

  // Title-casing edge shapes. Postgres initcap() splits words on any
  // non-alphanumeric; the TS regex uses \b\w, and \w includes underscore,
  // so an underscore is a word character to JS and a separator to Postgres.
  { name: "apostrophe in name", rawPayee: "O'BRIEN PUB", rawCategory: "Dining" },
  { name: "hyphenated name", rawPayee: "WAL-MART SUPERCENTER", rawCategory: "Groceries" },
  { name: "underscore in name", rawPayee: "FOO_BAR MARKET", rawCategory: "Groceries" },
  { name: "digits inside a word", rawPayee: "7ELEVEN STORE", rawCategory: "Shopping" },
  { name: "mixed case input", rawPayee: "bLuE bOtTlE", rawCategory: "Dining" },
  { name: "ampersand", rawPayee: "BED BATH & BEYOND", rawCategory: "Shopping" },

  // Vendor-name-only cleanup: geolocation, masked numbers, processor
  // prefixes, store numbers. The city logic is the most involved part of
  // either implementation, so it gets the most shapes.
  { name: "city and state", rawPayee: "DESI FOOD PLAZA BELLEVUE WA 03/15", rawCategory: "Groceries" },
  { name: "two-word city, first-word list", rawPayee: "PENDLETON NORTH BEND NORTH BEND WA 05/04", rawCategory: "Shopping" },
  { name: "two-word city, last-word list", rawPayee: "ACME DELI MERCER ISLAND WA", rawCategory: "Dining" },
  { name: "doubled city", rawPayee: "HMART - BELLEVUE BELLEVUE WA 03/01", rawCategory: "Groceries" },
  { name: "doubled city, mixed case", rawPayee: "Lululemon Bellevue BELLEVUE Wa 12/21", rawCategory: "Shopping" },
  { name: "dangling connector after city", rawPayee: "TOTAL WINE AND BELLEVUE WA 01/06", rawCategory: "Groceries" },
  { name: "connector kept without a city", rawPayee: "THE UNIVERSITY OF", rawCategory: "Education" },
  { name: "phone in city slot", rawPayee: "AMAZON KIDS+*168944D1 888-802-3080 WA 03/31", rawCategory: "Entertainment" },
  { name: "url in city slot", rawPayee: "SUPERHUMAN HTTPSSUPERHUM CA 04/22", rawCategory: "Software" },
  { name: "masked number in city slot", rawPayee: "WYZANT XXX-XXX-6365 CA 08/06", rawCategory: "Education" },
  { name: "business word is not a city", rawPayee: "SEA AIRPORT PARKING WA 07/14", rawCategory: "Transport" },
  { name: "ambiguous state keeps the word before", rawPayee: "BURGERS DRIVE IN", rawCategory: "Dining" },
  { name: "store number before city", rawPayee: "WINGSTOP 645 BELLEVUE WA 02/22", rawCategory: "Dining" },
  { name: "terminal number after state", rawPayee: "BEST BUY #497 BELLEVUE WA 509001 05/04", rawCategory: "Shopping" },
  { name: "zip code", rawPayee: "ACME STORE SEATTLE WA 98101", rawCategory: "Shopping" },
  { name: "masked number mid-descriptor", rawPayee: "CHAMEI MATCHA XXX-XXXX9024 WA 03/19", rawCategory: "Dining" },
  { name: "masked invoice token and url", rawPayee: "SQSP* INVXXXXX0207 HTTPSSQUARESP NY 01/15", rawCategory: "Software" },
  { name: "X-prefixed masked number", rawPayee: "DEPOSIT ID NUMBER X5399", rawCategory: "Income" },
  { name: "phone fragment left by digit run", rawPayee: "VIRGINIA MASON MEDICAL 206-2236601 WA 04/05", rawCategory: "Health" },
  { name: "ACH id with letter prefix", rawPayee: "ACME INC PAYROLL PPD ID: P123456789", rawCategory: "Income" },
  { name: "two-digit tail kept", rawPayee: "PUB 70", rawCategory: "Dining" },
  { name: "phone in every separator form", rawPayee: "SUPPORT LINE 800 555 1234", rawCategory: "Utilities" },
  { name: "date with spaces", rawPayee: "TOTAL WINE AND BELLEVUE WA 12 / 28", rawCategory: "Groceries" },
  { name: "toast prefix glued to name", rawPayee: "TST*FARZI CAFE BELLEVUE BELLEVUE WA 09/14", rawCategory: "Dining" },
  { name: "toast prefix with space", rawPayee: "TST* THAAL BELLEVUE WA 10/19", rawCategory: "Dining" },
  { name: "non-processor star token", rawPayee: "GOOGLE *PEACOCK 855-836-3987 CA 02/06", rawCategory: "Entertainment" },

  // Amount ranges and fallback ("uncategorized") rules.
  {
    name: "amount range, inside",
    rawPayee: "ACME INC", rawCategory: "Dining", amount: 999.99,
    rules: [rule({ match_value: "acme", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 })],
  },
  {
    name: "amount range, above",
    rawPayee: "ACME INC", rawCategory: "Dining", amount: 1000,
    rules: [rule({ match_value: "acme", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 })],
  },
  {
    name: "amount range, negative excluded",
    rawPayee: "ACME INC", rawCategory: "Dining", amount: -20,
    rules: [rule({ match_value: "acme", set_category: "Transfer", min_amount: 0.01 })],
  },
  {
    name: "amount range on a category rule",
    rawPayee: "ACME INC", rawCategory: "Food and Drink", amount: 15,
    rules: [rule({ match_field: "category", match_value: "food", set_category: "Dining", max_amount: 20 })],
  },
  {
    name: "fallback catches the uncategorized",
    rawPayee: "REMOTE ONLINE DEPOSIT # 1", rawCategory: "TRANSFER_IN", amount: 368.26,
    rules: [rule({ match_field: "uncategorized", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 })],
  },
  {
    name: "fallback skips what a raw category explains",
    rawPayee: "ACME REFUND", rawCategory: "Shopping", amount: 50,
    rules: [rule({ match_field: "uncategorized", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 })],
  },
  {
    name: "fallback skips what a later-listed rule explains",
    rawPayee: "ACME REFUND", rawCategory: "GENERAL_MERCHANDISE", amount: 50,
    rules: [
      rule({ match_field: "uncategorized", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 }),
      rule({ match_field: "category", match_value: "GENERAL_MERCHANDISE", set_category: "Shopping" }),
    ],
  },
  {
    name: "fallback outside its amount range",
    rawPayee: "REMOTE ONLINE DEPOSIT # 1", rawCategory: "TRANSFER_IN", amount: 1500,
    rules: [rule({ match_field: "uncategorized", set_category: "Transfer", min_amount: 0.01, max_amount: 999.99 })],
  },
  {
    name: "fallback with a payee filter and rename",
    rawPayee: "REMOTE ONLINE DEPOSIT # 1", rawCategory: "TRANSFER_IN", amount: 50,
    rules: [rule({ match_field: "uncategorized", match_value: "deposit", set_category: "Transfer", set_payee: "Deposit" })],
  },
  {
    name: "fallback to an out-of-set category clamps",
    rawPayee: "ACME INC", rawCategory: "Uncategorized", amount: 50,
    rules: [rule({ match_field: "uncategorized", set_category: "Crypto" })],
  },
  { name: "Transfer is in the closed set", rawPayee: "ACME INC", rawCategory: "Transfer" },

  // Out-of-set categories must clamp to Miscellaneous on both sides.
  { name: "out-of-set category clamps", rawPayee: "ACME INC", rawCategory: "Food and Drink" },
  { name: "lowercase category clamps", rawPayee: "ACME INC", rawCategory: "dining" },

  // Rule application.
  {
    name: "single payee rule",
    rawPayee: "BLUE BOTTLE COFFEE", rawCategory: "Dining",
    rules: [rule({ match_value: "bottle", set_category: "Groceries" })],
  },
  {
    name: "rule matches raw payee, not cleaned",
    rawPayee: "AMEX EPAYMENT XX1234", rawCategory: "Fees",
    rules: [rule({ match_value: "XX1234", set_category: "Utilities" })],
  },
  {
    name: "category-field rule",
    rawPayee: "ANY PAYEE", rawCategory: "Food and Drink",
    rules: [rule({ match_field: "category", match_value: "food", set_category: "Groceries" })],
  },
  {
    name: "later rule overwrites earlier",
    rawPayee: "ACME INC", rawCategory: "Fees",
    rules: [
      rule({ match_value: "acme", set_category: "Shopping" }),
      rule({ match_value: "acme", set_category: "Groceries" }),
    ],
  },
  {
    name: "rule sets payee only",
    rawPayee: "SQ COFFEE", rawCategory: "Dining",
    rules: [rule({ match_value: "coffee", set_payee: "Coffee Shop" })],
  },
  {
    name: "rule sets an out-of-set category, clamps after",
    rawPayee: "ACME INC", rawCategory: "Dining",
    rules: [rule({ match_value: "acme", set_category: "Crypto" })],
  },
  {
    name: "non-matching rule is inert",
    rawPayee: "ACME INC", rawCategory: "Dining",
    rules: [rule({ match_value: "nomatch", set_category: "Travel" })],
  },
  {
    name: "case-insensitive match",
    rawPayee: "AcMe InC", rawCategory: "Dining",
    rules: [rule({ match_value: "ACME", set_category: "Groceries" })],
  },
];

const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe("categoryRules TypeScript <-> SQL parity", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  // Runs one case through the SQL implementation in a transaction that is
  // always rolled back, so cases can't contaminate each other.
  async function runSql(testCase: ParityCase): Promise<{ payee: string; category: string }> {
    await client.query("begin");
    try {
      await client.query("insert into auth.users (id, email) values ($1, 'parity@test.invalid')", [USER_ID]);
      await client.query(
        `set local request.jwt.claims = '${JSON.stringify({ sub: USER_ID, role: "authenticated" })}'`
      );

      await client.query(
        `insert into public.transactions (date, payee, category, amount, user_id, raw_payee, raw_category, source, manually_edited)
         values ('2026-01-01', 'placeholder', 'placeholder', $4, $1, $2, $3, 'manual', false)`,
        [USER_ID, testCase.rawPayee, testCase.rawCategory, testCase.amount ?? -1]
      );

      // priority ascending preserves the array order the TS side applies,
      // so both implementations see the same rule sequence.
      let priority = 1;
      for (const r of testCase.rules ?? []) {
        await client.query(
          `insert into public.category_rules (user_id, priority, match_field, match_value, set_category, set_payee, min_amount, max_amount, enabled)
           values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
          [USER_ID, priority++, r.match_field, r.match_value, r.set_category, r.set_payee, r.min_amount ?? null, r.max_amount ?? null]
        );
      }

      await client.query("select public.apply_category_rules()");
      const { rows } = await client.query("select payee, category from public.transactions");
      return rows[0];
    } finally {
      await client.query("rollback");
    }
  }

  it.each(CASES)("$name", async (testCase) => {
    const sql = await runSql(testCase);
    const ts = applyCategoryRules(testCase.rawPayee, testCase.rawCategory, testCase.rules ?? [], testCase.amount ?? -1);

    expect({ payee: ts.payee, category: ts.category }).toEqual({ payee: sql.payee, category: sql.category });
  });

  // clean_payee is also called on its own by the titlecase/scrub baseline
  // migrations, so it's worth pinning independently of the rules engine.
  it.each(CASES.map((c) => c.rawPayee))("clean_payee(%j) matches cleanPayee()", async (rawPayee) => {
    const { rows } = await client.query("select public.clean_payee($1) as cleaned", [rawPayee]);
    expect(cleanPayee(rawPayee)).toBe(rows[0].cleaned);
  });
});
