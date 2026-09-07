import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import AccountBalances from "./AccountBalances";

type SelectResult = { data: any[] | null; error: { message: string } | null };

const state: { accounts: SelectResult; balances: SelectResult } = {
  accounts: { data: [], error: null },
  balances: { data: [], error: null },
};

const mockAccountsSelect = jest.fn(() => Promise.resolve(state.accounts));
const mockBalancesSelect = jest.fn(() => Promise.resolve(state.balances));
const mockFrom = jest.fn((table: string) => {
  if (table === "plaid_accounts") return { select: mockAccountsSelect };
  if (table === "plaid_account_balances") return { select: mockBalancesSelect };
  throw new Error(`Unexpected table: ${table}`);
});

jest.mock("../lib/supabase", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const mockUseAuth = jest.fn(() => ({ session: { access_token: "tok-1" } }));
const mockAuthProviderState = { TEST_LOGIN_ENABLED: false };
jest.mock("../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
  get TEST_LOGIN_ENABLED() {
    return mockAuthProviderState.TEST_LOGIN_ENABLED;
  },
}));

const mockStartLink = jest.fn();
const mockUseBankLink = jest.fn((_onLinked?: () => void) => ({
  startLink: mockStartLink,
  connecting: false,
  error: null as string | null,
}));
jest.mock("../lib/useBankLink", () => ({
  useBankLink: (onLinked?: () => void) => mockUseBankLink(onLinked),
}));

const mockFetch = jest.fn() as jest.Mock<any>;

function account(overrides: Record<string, unknown> = {}) {
  return { account_id: "acc-1", item_id: "item-1", name: "Checking", mask: "1234", ...overrides };
}

// The component makes two quite different POSTs, and only one of them is
// destructive. Mounting now also calls plaid-balance-refresh-user, so
// "the API was not called" has to mean the disconnect API specifically
// -- asserting on fetch as a whole would pass only by accident of the
// component never refreshing anything.
const callsTo = (fn: string) =>
  mockFetch.mock.calls.filter((c: any[]) => String(c[0]).includes(`/functions/v1/${fn}`));

// Stands in for Home, which owns the counter and raises it on
// pull-to-refresh. Bumping from inside the tree keeps the providers
// renderWithTheme supplies intact, which rerender() would discard.
function SignalHarness() {
  const [signal, setSignal] = useState(0);
  return (
    <>
      <Pressable testID="bump-signal" onPress={() => setSignal((s) => s + 1)}>
        <Text>bump</Text>
      </Pressable>
      <AccountBalances refreshSignal={signal} />
    </>
  );
}

describe("AccountBalances", () => {
  beforeEach(() => {
    mockAccountsSelect.mockClear();
    mockBalancesSelect.mockClear();
    mockFrom.mockClear();
    mockUseAuth.mockClear();
    mockUseBankLink.mockClear();
    mockStartLink.mockClear();
    mockAuthProviderState.TEST_LOGIN_ENABLED = false;
    mockUseBankLink.mockReturnValue({ startLink: mockStartLink, connecting: false, error: null });
    state.accounts = { data: [], error: null };
    state.balances = { data: [], error: null };
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });

  it("shows the empty state with no linked accounts", async () => {
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("No linked accounts yet")).toBeTruthy();
  });

  // The balance shown is the AVAILABLE one. `current` is the settled
  // balance and only moves once a charge posts, about a business day
  // after it is authorized; `available` moves straight away. Leading
  // with `current` -- which this used to do -- put a roughly one-day lag
  // between the user's own spending and the figure on their home screen,
  // while every commercial banking app beside it had already updated.
  it("shows the available balance, not the settled one, when both are present", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100.5, available: 90 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("Checking ••1234")).toBeTruthy();
    expect(screen.getByText("$90.00")).toBeTruthy();
    expect(screen.queryByText("$100.50")).toBeNull();
  });

  // Not every institution reports an available balance. A settled
  // balance beats no balance, so `current` is the fallback -- it is just
  // not the preference.
  it("falls back to the settled balance when available is null", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 42, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$42.00")).toBeTruthy();
  });

  it("uses the available balance when the settled one is null", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: null, available: 42 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$42.00")).toBeTruthy();
  });

  // A balance that quietly excludes money is only an improvement if you
  // can see what it excluded. The gap between the two figures IS the
  // pending activity -- $179.48 of it on the live account when this was
  // written -- so the row names it rather than leaving the user to
  // wonder why their app and their bank disagree.
  it("names the gap between the settled and available balances as pending", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100.5, available: 90 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByTestId("pending-hold")).toBeTruthy();
    expect(screen.getByText("$10.50 pending")).toBeTruthy();
  });

  it("says nothing about pending when the two balances agree", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 90, available: 90 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$90.00")).toBeTruthy();
    expect(screen.queryByTestId("pending-hold")).toBeNull();
  });

  it("says nothing about pending when only one of the two balances is known", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 90, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$90.00")).toBeTruthy();
    expect(screen.queryByTestId("pending-hold")).toBeNull();
  });

  // A pending CREDIT puts available above current. That is not a hold on
  // the account and must not be labelled as one -- the row would read
  // "-$10.00 pending", which is worse than saying nothing.
  it("says nothing about pending when available exceeds the settled balance", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 90, available: 100 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$100.00")).toBeTruthy();
    expect(screen.queryByTestId("pending-hold")).toBeNull();
  });

  // Caught on a real emulator, not in review: at 18pt the balance column
  // was still 96dp wide, so "$1,000.00" wrapped to "$1,000.0" over "0".
  // The column has to hold the widest balance anyone plausibly has, and
  // clip rather than wrap past that -- half a number on each of two lines
  // is worse than an ellipsis.
  it("keeps a four-figure balance on one line", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 1000, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);

    const amount = await screen.findByText("$1,000.00");
    expect(amount.props.numberOfLines).toBe(1);
    const style = StyleSheet.flatten(amount.props.style);
    expect(style.flexBasis).toBeGreaterThanOrEqual(style.fontSize * 6.5);
  });

  it("skips an account whose balance hasn't loaded at all", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: null, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("No linked accounts yet")).toBeTruthy();
  });

  it("shows the empty state (not a crash) when the accounts query errors", async () => {
    state.accounts = { data: null, error: { message: "boom" } };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("No linked accounts yet")).toBeTruthy();
  });

  // One Plaid item can carry many accounts -- the Sandbox test item seeds
  // twelve. Unbounded, the block pushed Recent Activity below the fold
  // and left the inline transaction editor opening in a sliver at the
  // bottom of the screen, with Save drawn over the navigation bar. Seen
  // on a real emulator; the design mockups had two banks.
  describe("with more accounts than fit above the fold", () => {
    const MANY = 12;
    function seedMany() {
      state.accounts = {
        data: Array.from({ length: MANY }, (_, i) =>
          account({ account_id: `acc-${i}`, name: `Account ${i}`, mask: String(1000 + i) })
        ),
        error: null,
      };
      state.balances = {
        data: Array.from({ length: MANY }, (_, i) => ({ account_id: `acc-${i}`, current: 100 + i, available: null })),
        error: null,
      };
    }

    it("folds to four rows and says how many are hidden", async () => {
      seedMany();
      await renderWithTheme(<AccountBalances />);
      await screen.findByText("Account 0 ••1000");

      expect(screen.getAllByTestId("linked-account-row")).toHaveLength(4);
      expect(screen.getByText("8 more")).toBeTruthy();
      expect(screen.getByTestId("banks-expand-toggle").props.accessibilityLabel).toBe("Show all 12 accounts");
    });

    it("expands to every row, and folds back", async () => {
      seedMany();
      await renderWithTheme(<AccountBalances />);
      await screen.findByText("Account 0 ••1000");

      await fireEvent.press(screen.getByTestId("banks-expand-toggle"));
      expect(screen.getAllByTestId("linked-account-row")).toHaveLength(MANY);
      expect(screen.getByTestId("banks-expand-toggle").props.accessibilityLabel).toBe("Show fewer accounts");

      await fireEvent.press(screen.getByTestId("banks-expand-toggle"));
      expect(screen.getAllByTestId("linked-account-row")).toHaveLength(4);
    });

    it("has no fold control when every account already fits", async () => {
      state.accounts = { data: [account()], error: null };
      state.balances = { data: [{ account_id: "acc-1", current: 100, available: null }], error: null };
      await renderWithTheme(<AccountBalances />);
      await screen.findByText("Checking ••1234");

      expect(screen.queryByTestId("banks-expand-toggle")).toBeNull();
    });
  });

  it("Add bank: shows a confirmation banner, then calls startLink on Proceed", async () => {
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("No linked accounts yet");

    await fireEvent.press(screen.getByTestId("add-bank-button"));
    expect(await screen.findByText("Only checking / savings accounts can be connected.")).toBeTruthy();
    expect(mockStartLink).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("add-bank-proceed-button"));
    expect(mockStartLink).toHaveBeenCalled();
  });

  it("Disconnect: requires two-step confirmation before calling plaid-disconnect", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100, available: null }], error: null };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await renderWithTheme(<AccountBalances />);
    await screen.findByText("Checking ••1234");

    await fireEvent.press(screen.getByTestId("disconnect-button"));
    expect(await screen.findByText(/Disconnect Checking ••1234\?/)).toBeTruthy();
    expect(callsTo("plaid-disconnect")).toHaveLength(0);

    await fireEvent.press(screen.getByTestId("disconnect-continue-button"));
    await fireEvent.press(screen.getByTestId("disconnect-confirm-button"));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/plaid-disconnect"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok-1" }),
        body: JSON.stringify({ id: "item-1" }),
      })
    );
  });

  // Regression guard, not a formality. The button this asserts the
  // absence of shipped in the preview build (TEST_LOGIN_ENABLED is set by
  // that EAS profile), and one tap while signed in as a real user seeded
  // Sandbox accounts into that real account and dropped its real bank
  // connection. Seeding a test bank is Detox's job, from its own host
  // process (mobile/e2e/testAccount.js) -- never the app's, in any build.
  it("renders no test-seeding control, even in a build with test login enabled", async () => {
    mockAuthProviderState.TEST_LOGIN_ENABLED = true;
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("No linked accounts yet");
    expect(screen.queryByTestId("test-plaid-link-button")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/test-plaid-link"),
      expect.anything()
    );
  });

  it("useBankLink's onDone callback (real Plaid Link success) refreshes balances and calls onLinked", async () => {
    const onLinked = jest.fn();
    let capturedOnDone: (() => void) | undefined;
    mockUseBankLink.mockImplementation((onLinkedArg?: () => void) => {
      capturedOnDone = onLinkedArg;
      return { startLink: mockStartLink, connecting: false, error: null };
    });

    await renderWithTheme(<AccountBalances onLinked={onLinked} />);
    await screen.findByText("No linked accounts yet");
    const callsBeforeRelink = mockAccountsSelect.mock.calls.length;

    await act(async () => {
      capturedOnDone?.();
    });

    expect(onLinked).toHaveBeenCalled();
    await waitFor(() => expect(mockAccountsSelect.mock.calls.length).toBeGreaterThan(callsBeforeRelink));
  });

  it("disconnecting an account with a sibling on the same item warns it'll go too", async () => {
    state.accounts = {
      data: [account({ account_id: "acc-1", item_id: "item-1", name: "Checking", mask: "1234" }), account({ account_id: "acc-2", item_id: "item-1", name: "Savings", mask: "5678" })],
      error: null,
    };
    state.balances = {
      data: [
        { account_id: "acc-1", current: 100, available: null },
        { account_id: "acc-2", current: 200, available: null },
      ],
      error: null,
    };
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("Checking ••1234");

    await fireEvent.press(screen.getAllByTestId("disconnect-button")[0]);
    expect(await screen.findByText(/This will also disconnect Savings ••5678/)).toBeTruthy();
  });

  it("shows the server's error and stays open (doesn't silently close) when disconnect fails", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100, available: null }], error: null };
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Plaid item not found" }) });

    await renderWithTheme(<AccountBalances />);
    await screen.findByText("Checking ••1234");

    await fireEvent.press(screen.getByTestId("disconnect-button"));
    await fireEvent.press(screen.getByTestId("disconnect-continue-button"));
    await fireEvent.press(screen.getByTestId("disconnect-confirm-button"));

    expect(await screen.findByText("Plaid item not found")).toBeTruthy();
    expect(screen.getByText(/Are you absolutely sure/)).toBeTruthy();
    expect(screen.getByText("Checking ••1234")).toBeTruthy();
  });

  it("Add bank: Cancel dismisses the banner without starting Link", async () => {
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("No linked accounts yet");

    await fireEvent.press(screen.getByTestId("add-bank-button"));
    await screen.findByText("Only checking / savings accounts can be connected.");
    await fireEvent.press(screen.getByTestId("add-bank-cancel-button"));

    expect(screen.queryByText("Only checking / savings accounts can be connected.")).toBeNull();
    expect(screen.getByTestId("add-bank-button")).toBeTruthy();
    expect(mockStartLink).not.toHaveBeenCalled();
  });

  it("Disconnect step 1: Cancel dismisses without advancing or calling the API", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("Checking ••1234");

    await fireEvent.press(screen.getByTestId("disconnect-button"));
    await screen.findByText(/Disconnect Checking ••1234\?/);
    await fireEvent.press(screen.getByTestId("disconnect-cancel-button"));

    expect(screen.queryByText(/Disconnect Checking ••1234\?/)).toBeNull();
    expect(callsTo("plaid-disconnect")).toHaveLength(0);
  });

  // The balances shown used to be whatever the hourly cron last wrote:
  // opening the app triggered no refresh, and pull-to-refresh reloaded
  // only the transaction list below. A balance you are looking at should
  // be the one the bank has now, which is what these four cover.
  describe("on-demand refresh", () => {
    it("asks Plaid for a fresh balance when it mounts, then reads the table", async () => {
      state.accounts = { data: [account()], error: null };
      state.balances = { data: [{ account_id: "acc-1", current: 100, available: 90 }], error: null };

      await renderWithTheme(<AccountBalances />);
      await screen.findByText("$90.00");

      const [url, opts] = callsTo("plaid-balance-refresh-user")[0] as any[];
      expect(url).toContain("plaid-balance-refresh-user");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer tok-1");
      expect(mockBalancesSelect).toHaveBeenCalled();
    });

    it("refreshes again when the signal is bumped", async () => {
      state.accounts = { data: [account()], error: null };
      state.balances = { data: [{ account_id: "acc-1", current: 100, available: 90 }], error: null };

      // The signal is bumped from inside the rendered tree rather than
      // by rerender(), which replaces the root and would take
      // renderWithTheme's ThemeProvider with it. This is also closer to
      // what Home actually does: hold the counter in state and raise it.
      await renderWithTheme(<SignalHarness />);
      await screen.findByText("$90.00");
      expect(callsTo("plaid-balance-refresh-user")).toHaveLength(1);

      state.balances = { data: [{ account_id: "acc-1", current: 100, available: 80 }], error: null };
      await fireEvent.press(screen.getByTestId("bump-signal"));

      await waitFor(() => expect(callsTo("plaid-balance-refresh-user")).toHaveLength(2));
      expect(await screen.findByText("$80.00")).toBeTruthy();
    });

    // Best-effort by design: offline, or Plaid down, or an Item needing
    // re-auth, the stored balance is still the best number available and
    // is worth more than an empty block or an error.
    it("still shows the stored balance when the refresh call fails", async () => {
      state.accounts = { data: [account()], error: null };
      state.balances = { data: [{ account_id: "acc-1", current: 100, available: 90 }], error: null };
      mockFetch.mockRejectedValue(new Error("offline"));

      await renderWithTheme(<AccountBalances />);

      expect(await screen.findByText("$90.00")).toBeTruthy();
    });

    it("reads the table without calling Plaid when there is no session", async () => {
      mockUseAuth.mockReturnValue({ session: null } as any);
      state.accounts = { data: [account()], error: null };
      state.balances = { data: [{ account_id: "acc-1", current: 100, available: 90 }], error: null };

      await renderWithTheme(<AccountBalances />);

      expect(await screen.findByText("$90.00")).toBeTruthy();
      expect(callsTo("plaid-balance-refresh-user")).toHaveLength(0);
    });
  });

  it("Disconnect step 2: Cancel dismisses without calling the API", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100, available: null }], error: null };
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("Checking ••1234");

    await fireEvent.press(screen.getByTestId("disconnect-button"));
    await fireEvent.press(screen.getByTestId("disconnect-continue-button"));
    await screen.findByText(/Are you absolutely sure/);
    await fireEvent.press(screen.getByTestId("disconnect-final-cancel-button"));

    expect(screen.queryByText(/Are you absolutely sure/)).toBeNull();
    expect(callsTo("plaid-disconnect")).toHaveLength(0);
  });
});
