import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../lib/testUtils";
import AppLayout from "./_layout";

const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("../../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("../../lib/DataProvider", () => {
  const { View: RNView } = require("react-native");
  return {
    DataProvider: ({ children }: { children: any }) => <RNView testID="data-provider">{children}</RNView>,
  };
});

type SelectResult = { data: any[] | null; error: { message: string } | null };
const state: { plaidItems: SelectResult } = { plaidItems: { data: [], error: null } };

const mockLimit = jest.fn(() => Promise.resolve(state.plaidItems));
const mockSelect = jest.fn(() => ({ limit: mockLimit }));
const mockFrom = jest.fn((table: string) => {
  if (table === "plaid_items") return { select: mockSelect };
  throw new Error(`Unexpected table: ${table}`);
});
jest.mock("../../lib/supabase", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

jest.mock("../../components/PlaidLinkGate", () => {
  const { Pressable: RNPressable, Text: RNText } = require("react-native");
  return function MockPlaidLinkGate({ onDone }: { onDone: () => void }) {
    return (
      <RNPressable testID="mock-plaid-gate-done" onPress={onDone}>
        <RNText>mock plaid gate</RNText>
      </RNPressable>
    );
  };
});

jest.mock("expo-router", () => {
  const { Text: RNText } = require("react-native");
  const Stack = ({ children }: { children: any }) => <>{children}</>;
  Stack.Screen = () => null;
  return {
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    Stack,
  };
});

// _layout.tsx guards everything under (app)/ -- a session check, then a
// one-time "does this user have a linked bank yet" check that must fail
// open (not block the whole app) if that query itself errors. Not yet
// covered anywhere else in Stage 1.
describe("AppLayout", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockLimit.mockReset().mockImplementation(() => Promise.resolve(state.plaidItems));
    state.plaidItems = { data: [], error: null };
  });

  it("renders nothing while the session is still loading", async () => {
    mockUseAuth.mockReturnValue({ session: null, loading: true });
    await renderWithTheme(<AppLayout />);
    expect(screen.toJSON()).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("redirects to /login when there's no session", async () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false });
    await renderWithTheme(<AppLayout />);
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/login");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("renders nothing while the plaid_items check is still in flight", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    let resolveLimit!: (v: SelectResult) => void;
    mockLimit.mockImplementationOnce(() => new Promise((resolve) => (resolveLimit = resolve)));
    await renderWithTheme(<AppLayout />);
    expect(screen.toJSON()).toBeNull();
    resolveLimit({ data: [], error: null });
    // Settle the promise before the test (and its render tree) tears down,
    // so this doesn't leak an act() warning into whichever test runs next.
    await screen.findByTestId("mock-plaid-gate-done");
  });

  it("fails open (shows the Plaid link gate, not a crash or blank screen) when the plaid_items check errors", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    state.plaidItems = { data: null, error: { message: "boom" } };
    await renderWithTheme(<AppLayout />);
    expect(await screen.findByTestId("mock-plaid-gate-done")).toBeTruthy();
    expect(screen.queryByTestId("data-provider")).toBeNull();
  });

  it("shows the Plaid link gate when the user has no linked bank yet", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    state.plaidItems = { data: [], error: null };
    await renderWithTheme(<AppLayout />);
    expect(await screen.findByTestId("mock-plaid-gate-done")).toBeTruthy();
  });

  it("skips the link gate (without re-querying) once its onDone fires, and shows the app", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    state.plaidItems = { data: [], error: null };
    await renderWithTheme(<AppLayout />);
    await screen.findByTestId("mock-plaid-gate-done");
    const callsBeforeSkip = mockFrom.mock.calls.length;

    await fireEvent.press(screen.getByTestId("mock-plaid-gate-done"));

    await waitFor(() => expect(screen.getByTestId("data-provider")).toBeTruthy());
    expect(mockFrom.mock.calls.length).toBe(callsBeforeSkip);
  });

  it("renders the app (DataProvider + Stack) directly when a bank is already linked", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    state.plaidItems = { data: [{ id: "item-1", institution_name: "Chase", status: "active" }], error: null };
    await renderWithTheme(<AppLayout />);
    expect(await screen.findByTestId("data-provider")).toBeTruthy();
    expect(screen.queryByTestId("mock-plaid-gate-done")).toBeNull();
  });
});
