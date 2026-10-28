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

  it("strips long reference digit runs and trailing store numbers, but not a 1-2 digit tail", () => {
    expect(cleanPayee("STORE 1234567 MAIN")).toBe("STORE MAIN");
    expect(cleanPayee("STORE 123456")).toBe("STORE");
    expect(cleanPayee("PUB 70")).toBe("PUB 70");
  });

  it("strips a trailing MM/DD or MM/DD/YYYY date", () => {
    expect(cleanPayee("ACME INC 07/14")).toBe("ACME INC");
    expect(cleanPayee("ACME INC 07/14/2026")).toBe("ACME INC");
  });

  it("strips a trailing city and state", () => {
    expect(cleanPayee("BLUE BOTTLE SEATTLE WA")).toBe("BLUE BOTTLE");
    expect(cleanPayee("DESI FOOD PLAZA BELLEVUE WA 03/15")).toBe("DESI FOOD PLAZA");
  });

  it("strips a two-word city", () => {
    expect(cleanPayee("PENDLETON NORTH BEND NORTH BEND WA 05/04")).toBe("PENDLETON");
    expect(cleanPayee("BRICK HOUSE BAR & PORT ORCHARD WA 07/03")).toBe("BRICK HOUSE BAR");
  });

  it("strips the city again when the name already ended in it", () => {
    expect(cleanPayee("HMART - BELLEVUE BELLEVUE WA 03/01")).toBe("HMART");
    expect(cleanPayee("LULULEMON BELLEVUE BELLEVUE WA 12/21")).toBe("LULULEMON");
  });

  it("drops a connector left dangling by the city removal, and only then", () => {
    expect(cleanPayee("TOTAL WINE AND BELLEVUE WA 01/06")).toBe("TOTAL WINE");
    expect(cleanPayee("KANISHKA CUISINE OF REDMOND WA 05/29")).toBe("KANISHKA CUISINE");
    expect(cleanPayee("THE UNIVERSITY OF")).toBe("THE UNIVERSITY OF");
  });

  it("treats a phone number, URL or masked number in the city slot as the city", () => {
    expect(cleanPayee("AMAZON KIDS+*168944D1 888-802-3080 WA 03/31")).toBe("AMAZON KIDS+");
    expect(cleanPayee("SUPERHUMAN HTTPSSUPERHUM CA 04/22")).toBe("SUPERHUMAN");
    expect(cleanPayee("WYZANT XXX-XXX-6365 CA 08/06")).toBe("WYZANT");
  });

  it("keeps a business word that only looks like it is in the city slot", () => {
    expect(cleanPayee("SEA AIRPORT PARKING WA 07/14")).toBe("SEA AIRPORT PARKING");
    expect(cleanPayee("PREMIER PERIODONTICS, PLLC WA 11/13")).toBe("PREMIER PERIODONTICS, PLLC");
  });

  it("strips trailing store numbers and ZIP codes", () => {
    expect(cleanPayee("WINGSTOP 645 BELLEVUE WA 02/22")).toBe("WINGSTOP");
    expect(cleanPayee("BEST BUY #497 BELLEVUE WA 509001 05/04")).toBe("BEST BUY");
    expect(cleanPayee("ACME STORE SEATTLE WA 98101")).toBe("ACME STORE");
  });

  it("strips leftover masked numbers and phone fragments", () => {
    expect(cleanPayee("CHAMEI MATCHA XXX-XXXX9024 WA 03/19")).toBe("CHAMEI MATCHA");
    expect(cleanPayee("SQSP* INVXXXXX0207 HTTPSSQUARESP NY 01/15")).toBe("SQSP");
    expect(cleanPayee("DEPOSIT ID NUMBER X5399")).toBe("DEPOSIT ID NUMBER");
    expect(cleanPayee("VIRGINIA MASON MEDICAL 206-2236601 WA 04/05")).toBe("VIRGINIA MASON MEDICAL");
  });

  it("strips ACH ids that carry a letter prefix", () => {
    expect(cleanPayee("ACME INC PAYROLL PPD ID: P123456789")).toBe("ACME INC PAYROLL");
  });

  it("strips a date written with spaces around the slash", () => {
    expect(cleanPayee("TOTAL WINE AND BELLEVUE WA 12 / 28")).toBe("TOTAL WINE");
  });

  it("keeps the merchant name after a card-processor prefix", () => {
    expect(cleanPayee("SQ *COFFEE BAR")).toBe("COFFEE BAR");
    expect(cleanPayee("SQ *BLUEBOTTLE")).toBe("BLUEBOTTLE");
    expect(cleanPayee("TST* THAAL BELLEVUE WA 10/19")).toBe("THAAL");
    expect(cleanPayee("TST*FARZI CAFE BELLEVUE BELLEVUE WA 09/14")).toBe("FARZI CAFE");
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
    // `\*[a-zA-Z0-9]+` removes the asterisk AND the token after it. Known
    // processor prefixes (SQ *, TST*, ...) are stripped before it runs, but
    // any other "<NAME>*<NAME>" descriptor still loses the part after '*'.
    it("deletes the token following '*' outside the known processor prefixes", () => {
      expect(cleanPayee("GOOGLE *PEACOCK")).toBe("GOOGLE");
    });

    // The trailing-state rule treats any 2-letter tail as a state. "CO" is
    // Colorado, so every "<NAME> CO" company descriptor loses its suffix.
    // Same hazard for other real words in the list: IN, OR, ME, OK, HI, DE,
    // PA, LA, MA, MS, MT, NE, NV, OH, SC, VA, WA, ID. For the most word-like
    // of these (IN, OR, CO, ...) the word before is at least not also taken
    // as a city.
    it("strips a trailing 'CO' from company names, reading it as Colorado", () => {
      expect(cleanPayee("ACME CO")).toBe("ACME");
      expect(cleanPayee("TRADING CO")).toBe("TRADING");
      expect(cleanPayee("BURGERS DRIVE IN")).toBe("BURGERS DRIVE");
    });

    // A descriptor with no city field ("<NAME> <ST>") loses the name's last
    // word, which sits where the city usually is -- unless that word is in
    // the business-word list.
    it("takes the last word of a city-less descriptor as the city", () => {
      expect(cleanPayee("UPS DINING & CONF SVCS WA 01/05")).toBe("UPS DINING & CONF SVCS");
      expect(cleanPayee("ACME WIDGETS WA 01/05")).toBe("ACME");
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
      "Insurance", "Home Services", "Personal Care",
    ];
    for (const category of allowed) {
      expect(applyCategoryRules("ACME INC", category, []).category).toBe(category);
    }
  });

  it("cleans and title-cases the payee before any rule overwrites it", () => {
    const result = applyCategoryRules("BLUE BOTTLE SEATTLE WA", "Dining", []);
    expect(result.payee).toBe("Blue Bottle");
  });
});
