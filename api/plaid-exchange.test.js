import { describe, it, expect } from "vitest";
import { partitionDuplicateAccounts } from "./plaid-exchange.js";

// Regression coverage for the duplicate-bank-connection bug: relinking an
// already-connected institution must only skip the specific accounts that
// match an existing one, not block the whole institution (that over-broad
// version blocked legitimately adding a second, different account at a
// bank already connected).
describe("partitionDuplicateAccounts", () => {
  const checking = { account_id: "new_checking", mask: "2581", type: "depository", subtype: "checking" };
  const savings = { account_id: "new_savings", mask: "9999", type: "depository", subtype: "savings" };

  it("treats accounts at a wholly different institution as new", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking],
      institutionId: "ins_other",
      newAuthByAccountId: {},
      existingAccounts: [
        { account_id: "existing_checking", mask: "2581", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: {},
    });
    expect(newAccounts).toEqual([checking]);
    expect(duplicateAccounts).toEqual([]);
  });

  it("flags an account as a duplicate when its account/routing numbers match an existing account, even across different Items", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking],
      institutionId: "ins_chase",
      newAuthByAccountId: { new_checking: { account_number: "111", routing_number: "222" } },
      existingAccounts: [
        { account_id: "existing_checking", mask: "0000", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: { existing_checking: { account_number: "111", routing_number: "222" } },
    });
    expect(newAccounts).toEqual([]);
    expect(duplicateAccounts).toEqual([checking]);
  });

  it("does not flag a genuinely different account at the same institution as a duplicate (adding savings after checking)", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [savings],
      institutionId: "ins_chase",
      newAuthByAccountId: { new_savings: { account_number: "333", routing_number: "222" } },
      existingAccounts: [
        { account_id: "existing_checking", mask: "2581", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: { existing_checking: { account_number: "111", routing_number: "222" } },
    });
    expect(newAccounts).toEqual([savings]);
    expect(duplicateAccounts).toEqual([]);
  });

  it("only skips the matching account when relinking a mix of one duplicate and one new account in the same Item", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking, savings],
      institutionId: "ins_chase",
      newAuthByAccountId: {
        new_checking: { account_number: "111", routing_number: "222" },
        new_savings: { account_number: "333", routing_number: "222" },
      },
      existingAccounts: [
        { account_id: "existing_checking", mask: "2581", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: { existing_checking: { account_number: "111", routing_number: "222" } },
    });
    expect(newAccounts).toEqual([savings]);
    expect(duplicateAccounts).toEqual([checking]);
  });

  it("falls back to institution + mask + type/subtype when Auth numbers aren't available for the new account", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking],
      institutionId: "ins_chase",
      newAuthByAccountId: {}, // Auth unavailable for this institution
      existingAccounts: [
        { account_id: "existing_checking", mask: "2581", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: {},
    });
    expect(newAccounts).toEqual([]);
    expect(duplicateAccounts).toEqual([checking]);
  });

  it("does not fall back across institutions -- a matching mask at a different bank is not a duplicate", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking],
      institutionId: "ins_other_bank",
      newAuthByAccountId: {},
      existingAccounts: [
        { account_id: "existing_checking", mask: "2581", type: "depository", subtype: "checking", plaid_items: { institution_id: "ins_chase" } },
      ],
      existingAuthByAccountId: {},
    });
    expect(newAccounts).toEqual([checking]);
    expect(duplicateAccounts).toEqual([]);
  });

  it("allows relinking an account that was properly disconnected (not present in existingAccounts, since dedup is scoped to active items)", () => {
    const { newAccounts, duplicateAccounts } = partitionDuplicateAccounts({
      accounts: [checking],
      institutionId: "ins_chase",
      newAuthByAccountId: { new_checking: { account_number: "111", routing_number: "222" } },
      existingAccounts: [], // the old connection was disconnected and its row is gone
      existingAuthByAccountId: {},
    });
    expect(newAccounts).toEqual([checking]);
    expect(duplicateAccounts).toEqual([]);
  });
});
