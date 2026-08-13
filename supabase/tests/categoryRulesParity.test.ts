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
  { name: "short digit run kept", rawPayee: "STORE 123456", rawCategory: "Shopping" },
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
         values ('2026-01-01', 'placeholder', 'placeholder', -1.00, $1, $2, $3, 'manual', false)`,
        [USER_ID, testCase.rawPayee, testCase.rawCategory]
      );

      // priority ascending preserves the array order the TS side applies,
      // so both implementations see the same rule sequence.
      let priority = 1;
      for (const r of testCase.rules ?? []) {
        await client.query(
          `insert into public.category_rules (user_id, priority, match_field, match_value, set_category, set_payee, enabled)
           values ($1, $2, $3, $4, $5, $6, true)`,
          [USER_ID, priority++, r.match_field, r.match_value, r.set_category, r.set_payee]
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
    const ts = applyCategoryRules(testCase.rawPayee, testCase.rawCategory, testCase.rules ?? []);

    expect({ payee: ts.payee, category: ts.category }).toEqual({ payee: sql.payee, category: sql.category });
  });

  // clean_payee is also called on its own by the titlecase/scrub baseline
  // migrations, so it's worth pinning independently of the rules engine.
  it.each(CASES.map((c) => c.rawPayee))("clean_payee(%j) matches cleanPayee()", async (rawPayee) => {
    const { rows } = await client.query("select public.clean_payee($1) as cleaned", [rawPayee]);
    expect(cleanPayee(rawPayee)).toBe(rows[0].cleaned);
  });
});
