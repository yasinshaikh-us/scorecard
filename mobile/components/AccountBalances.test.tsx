import { describe, it, expect, jest, beforeEach } from "@jest/globals";
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
    delete (process.env as any).EXPO_PUBLIC_TEST_PLAID_LINK_SECRET;
  });

  it("shows the empty state with no linked accounts", async () => {
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("No linked accounts yet")).toBeTruthy();
  });

  it("prefers the current balance over available when both are present", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: 100.5, available: 90 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("Checking ••1234")).toBeTruthy();
    expect(screen.getByText("$100.50")).toBeTruthy();
  });

  it("falls back to the available balance when current is null", async () => {
    state.accounts = { data: [account()], error: null };
    state.balances = { data: [{ account_id: "acc-1", current: null, available: 42 }], error: null };
    await renderWithTheme(<AccountBalances />);
    expect(await screen.findByText("$42.00")).toBeTruthy();
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
    expect(global.fetch).not.toHaveBeenCalled();

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

  it("doesn't render the test-plaid-link button in a build without test login enabled", async () => {
    mockAuthProviderState.TEST_LOGIN_ENABLED = false;
    await renderWithTheme(<AccountBalances />);
    await screen.findByText("No linked accounts yet");
    expect(screen.queryByTestId("test-plaid-link-button")).toBeNull();
  });

  it("Link test bank: posts the secret and refreshes on success", async () => {
    mockAuthProviderState.TEST_LOGIN_ENABLED = true;
    process.env.EXPO_PUBLIC_TEST_PLAID_LINK_SECRET = "plaid-shh";
    const onLinked = jest.fn();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await renderWithTheme(<AccountBalances onLinked={onLinked} />);
    await screen.findByText("No linked accounts yet");

    await fireEvent.press(screen.getByTestId("test-plaid-link-button"));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/test-plaid-link"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok-1" }),
        body: JSON.stringify({ secret: "plaid-shh" }),
      })
    );
    expect(onLinked).toHaveBeenCalled();
  });

  it("Link test bank: shows the server's error on failure", async () => {
    mockAuthProviderState.TEST_LOGIN_ENABLED = true;
    process.env.EXPO_PUBLIC_TEST_PLAID_LINK_SECRET = "plaid-shh";
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "PLAID_ENV is production, not sandbox" }),
    });

    await renderWithTheme(<AccountBalances />);
    await screen.findByText("No linked accounts yet");

    await fireEvent.press(screen.getByTestId("test-plaid-link-button"));
    expect(await screen.findByText("PLAID_ENV is production, not sandbox")).toBeTruthy();
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
    expect(global.fetch).not.toHaveBeenCalled();
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
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
