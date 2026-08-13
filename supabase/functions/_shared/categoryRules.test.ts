import { describe, it, expect } from "vitest";
import { cleanPayee, applyCategoryRules, type CategoryRule } from "./categoryRules.ts";

// categoryRules.ts is the live, per-transaction half of the category
// engine (it runs inside syncItemTransactions for every row Plaid sends).
// Its SQL twin, apply_category_rules()/clean_payee(), is the retroactive
// bulk half. Both must agree; that cross-implementation agreement is
// asserted separately in supabase/tests/sql/ against a real Postgres.
// These tests pin the TypeScript side's behavior on its own.
//
// Two cases below assert behavior that looks WRONG rather than intended
// (see "known quirks"). They are pinned as-is deliberately: both
// implementations share the same regexes, so "fixing" one here would
// break parity with the SQL and silently change how live transactions
// categorize. Changing them is a product decision, not a test fix.

function rule(partial: Partial<CategoryRule>): CategoryRule {
  return { match_field: "payee", match_value: "", set_category: null, set_payee: null, ...partial };
}

describe("cleanPayee", () => {
  it("strips masked account suffixes", () => {
    expect(cleanPayee("AMEX EPAYMENT XX1234")).toBe("AMEX EPAYMENT");
  });

  it("strips the transfer boilerplate prefix so the counterparty becomes the payee", () => {
    expect(cleanPayee("Online Transfer To Jane Doe")).toBe("Jane Doe");
    expect(cleanPayee("Realtime Transfer From Jane Doe")).toBe("Jane Doe");
    expect(cleanPayee("Online Realtime Transfer To Jane Doe")).toBe("Jane Doe");
    expect(cleanPayee("transfer to Jane Doe")).toBe("Jane Doe");
  });

  it("strips labeled reference junk whether or not a value follows", () => {
    expect(cleanPayee("ACME INC Transaction#: 9255370026RX")).toBe("ACME INC");
    expect(cleanPayee("ACME INC Reference#: ABC123")).toBe("ACME INC");
    expect(cleanPayee("ACME INC Transaction#:")).toBe("ACME INC");
  });

  it("strips ACH entry-class ID codes", () => {
    expect(cleanPayee("PAYROLL DEP PPD ID: 1234567890")).toBe("PAYROLL DEP");
    expect(cleanPayee("SOME BILLER WEB ID 987654")).toBe("SOME BILLER");
  });

  it("strips phone numbers in the common separator forms", () => {
    expect(cleanPayee("SUPPORT LINE 800-555-1234")).toBe("SUPPORT LINE");
    expect(cleanPayee("SUPPORT LINE 800.555.1234")).toBe("SUPPORT LINE");
    expect(cleanPayee("SUPPORT LINE 800 555 1234")).toBe("SUPPORT LINE");
  });

  it("strips long reference digit runs but leaves short numbers alone", () => {
    expect(cleanPayee("STORE 1234567")).toBe("STORE");
    expect(cleanPayee("STORE 123456")).toBe("STORE 123456");
  });

  it("strips a trailing MM/DD or MM/DD/YYYY date", () => {
    expect(cleanPayee("ACME INC 07/14")).toBe("ACME INC");
    expect(cleanPayee("ACME INC 07/14/2026")).toBe("ACME INC");
  });

  it("strips a trailing US state abbreviation", () => {
    expect(cleanPayee("BLUE BOTTLE SEATTLE WA")).toBe("BLUE BOTTLE SEATTLE");
  });

  it("collapses whitespace left behind by the other rules", () => {
    expect(cleanPayee("ACME   INC    XX99")).toBe("ACME INC");
  });

  // Documented deliberate non-behavior: a leading numeric store code is
  // ambiguous (it may be part of the real name), unlike a phone number or
  // date, so it is left alone.
  it("leaves a leading numeric store code alone", () => {
    expect(cleanPayee("4761 Bellevue Bellevue")).toBe("4761 Bellevue Bellevue");
  });

  // The `|| raw` fallback: scrubbing must never produce an empty payee.
  it("falls back to the raw string when scrubbing would empty it", () => {
    expect(cleanPayee("XX1234")).toBe("XX1234");
    expect(cleanPayee("*ABC")).toBe("*ABC");
  });

  describe("known quirks (pinned, not endorsed)", () => {
    // `\*[a-zA-Z0-9]+` removes the asterisk AND the token after it. Square
    // descriptors are literally "SQ *MERCHANTNAME", so for the single most
    // common form of this descriptor the rule deletes the merchant name and
    // keeps the processor prefix -- the opposite of what the comment above
    // it ("transaction reference codes after '*'") describes wanting.
    it("deletes the token following '*', which eats Square merchant names", () => {
      expect(cleanPayee("SQ *COFFEE BAR")).toBe("SQ BAR");
      expect(cleanPayee("SQ *BLUEBOTTLE")).toBe("SQ");
    });

    // The trailing-state rule treats any 2-letter tail as a state. "CO" is
    // Colorado, so every "<NAME> CO" company descriptor loses its suffix.
    // Same hazard for other real words in the list: IN, OR, ME, OK, HI, DE,
    // PA, LA, MA, MS, MT, NE, NV, OH, SC, VA, WA, ID.
    it("strips a trailing 'CO' from company names, reading it as Colorado", () => {
      expect(cleanPayee("ACME CO")).toBe("ACME");
      expect(cleanPayee("TRADING CO")).toBe("TRADING");
    });
  });
});

describe("applyCategoryRules", () => {
  it("title-cases the cleaned payee when no rule matches", () => {
    const result = applyCategoryRules("BLUE BOTTLE COFFEE", "Dining", []);
    expect(result.payee).toBe("Blue Bottle Coffee");
    expect(result.category).toBe("Dining");
  });

  it("matches case-insensitively on a substring, not the whole value", () => {
    const rules = [rule({ match_value: "bottle", set_category: "Groceries" })];
    expect(applyCategoryRules("BLUE BOTTLE COFFEE", "Dining", rules).category).toBe("Groceries");
  });

  it("matches against the RAW payee, not the cleaned/title-cased one", () => {
    // "XX1234" is scrubbed out of the payee, but a rule matching it must
    // still fire -- the haystack is the raw descriptor.
    const rules = [rule({ match_value: "XX1234", set_category: "Utilities" })];
    expect(applyCategoryRules("AMEX EPAYMENT XX1234", "Fees", rules).category).toBe("Utilities");
  });

  it("matches on the category field when match_field is category", () => {
    const rules = [rule({ match_field: "category", match_value: "food", set_category: "Groceries" })];
    expect(applyCategoryRules("ANY PAYEE", "Food and Drink", rules).category).toBe("Groceries");
  });

  it("applies rules in array order, later matches overwriting earlier ones", () => {
    const rules = [
      rule({ match_value: "acme", set_category: "Shopping" }),
      rule({ match_value: "acme", set_category: "Groceries" }),
    ];
    expect(applyCategoryRules("ACME INC", "Fees", rules).category).toBe("Groceries");
  });

  it("lets a rule set payee and category independently", () => {
    const rules = [
      rule({ match_value: "acme", set_category: "Groceries", set_payee: null }),
      rule({ match_value: "acme", set_category: null, set_payee: "Acme Groceries" }),
    ];
    const result = applyCategoryRules("ACME INC", "Fees", rules);
    expect(result).toEqual({ category: "Groceries", payee: "Acme Groceries" });
  });

  it("leaves a field untouched when the matching rule sets it to null", () => {
    const rules = [rule({ match_value: "acme", set_category: null, set_payee: null })];
    const result = applyCategoryRules("ACME INC", "Dining", rules);
    expect(result).toEqual({ category: "Dining", payee: "Acme Inc" });
  });

  it("ignores rules that do not match", () => {
    const rules = [rule({ match_value: "nomatch", set_category: "Travel" })];
    expect(applyCategoryRules("ACME INC", "Dining", rules).category).toBe("Dining");
  });

  it("falls back to Miscellaneous for a category outside the closed set", () => {
    expect(applyCategoryRules("ACME INC", "Food and Drink", []).category).toBe("Miscellaneous");
  });

  it("falls back to Miscellaneous even when a RULE set the out-of-set value", () => {
    // The closed-set clamp runs after every rule, so a user-authored rule
    // can't introduce a category the app doesn't know how to render.
    const rules = [rule({ match_value: "acme", set_category: "Crypto" })];
    expect(applyCategoryRules("ACME INC", "Dining", rules).category).toBe("Miscellaneous");
  });

  it("is case-sensitive about the closed set itself", () => {
    // "dining" is not "Dining" -- the clamp is an exact set membership
    // check, so a lowercase variant is not silently accepted.
    expect(applyCategoryRules("ACME INC", "dining", []).category).toBe("Miscellaneous");
  });

  it("accepts every category in the closed set unchanged", () => {
    const allowed = [
      "Income", "Mortgage", "Investments", "Rent", "Alimony", "Taxes", "Miscellaneous",
      "Dining", "Shopping", "Utilities", "Groceries", "Transport", "Education", "Health",
      "Cash", "Travel", "Software", "Entertainment", "Fees",
    ];
    for (const category of allowed) {
      expect(applyCategoryRules("ACME INC", category, []).category).toBe(category);
    }
  });

  it("cleans and title-cases the payee before any rule overwrites it", () => {
    const result = applyCategoryRules("BLUE BOTTLE SEATTLE WA", "Dining", []);
    expect(result.payee).toBe("Blue Bottle Seattle");
  });
});
