import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../../lib/testUtils";
import Home from "./home";
import type { Transaction } from "../../lib/types";

const mockSignOut = jest.fn() as jest.Mock<any>;
const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("../../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseData = jest.fn() as jest.Mock<any>;
jest.mock("../../lib/DataProvider", () => ({
  useData: () => mockUseData(),
}));

const mockReplace = jest.fn() as jest.Mock<any>;
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}));

jest.mock("../../components/TransactionRow", () => {
  const { Text: RNText, Pressable: RNPressable } = require("react-native");
  return function MockTransactionRow({ row, onDrilldown }: any) {
    return (
      <RNPressable testID="tx-row-drill" onPress={() => onDrilldown?.({ kind: "category", value: row.Category })}>
        <RNText testID="tx-row">{row.Payee}</RNText>
      </RNPressable>
    );
  };
});

// Renders the signal it was handed, so the test can see that
// pull-to-refresh reaches the balances and not just the ledger.
jest.mock("../../components/AccountBalances", () => {
  const { Text: RNText } = require("react-native");
  return function MockAccountBalances({ refreshSignal }: { refreshSignal?: number }) {
    return <RNText testID="account-balances">{`balances:${refreshSignal ?? 0}`}</RNText>;
  };
});

jest.mock("../../components/CategoryRulesPanel", () => {
  const { Text: RNText, Pressable: RNPressable } = require("react-native");
  return function MockCategoryRulesPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    if (!visible) return null;
    return (
      <RNPressable testID="rules-panel-close" onPress={onClose}>
        <RNText>rules panel</RNText>
      </RNPressable>
    );
  };
});

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    Id: 1,
    Date: "2026-01-10",
    Payee: "Store",
    Category: "Groceries",
    Amount: -10,
    Account: "Checking",
    IsTransfer: false,
    Pending: false,
    ...overrides,
  };
}

function ready(overrides: Partial<ReturnType<typeof baseData>> = {}) {
  mockUseData.mockReturnValue({ ...baseData(), ...overrides });
}
function baseData() {
  return { transactions: [] as Transaction[], dataStatus: "ready" as const, CATS: [], refresh: jest.fn() };
}

// Covers home.tsx's own "recent 7 days" windowing (anchored to the
// ledger's own latest date, not device "now" -- see daysBefore's comment),
// loading/error/empty states, and the sign-out/rules controls -- none of
// it exercised anywhere else in Stage 1 (see mobile/README.md's "Not yet
// covered" note, home.tsx wasn't even in that list but had 0% coverage).
describe("Home", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockUseAuth.mockReset();
    mockUseData.mockReset();
    mockReplace.mockReset();
    mockUseAuth.mockReturnValue({ signOut: mockSignOut });
  });

  it("shows a loading placeholder while data isn't ready yet", async () => {
    mockUseData.mockReturnValue({ transactions: [], dataStatus: "loading", CATS: [], refresh: jest.fn() });
    await renderWithTheme(<Home />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByTestId("tx-row")).toBeNull();
  });

  it("shows an error message when the data fetch failed", async () => {
    mockUseData.mockReturnValue({ transactions: [], dataStatus: "error", CATS: [], refresh: jest.fn() });
    await renderWithTheme(<Home />);
    expect(screen.getByText("Couldn't load transaction data")).toBeTruthy();
  });

  it("shows a distinct empty state for a ledger with no transactions at all", async () => {
    ready({ transactions: [] });
    await renderWithTheme(<Home />);
    expect(screen.getByText("No transactions yet")).toBeTruthy();
  });

  it("only shows transactions within 7 days of the ledger's own latest date, not device 'now', sorted newest first", async () => {
    ready({
      transactions: [
        tx({ Id: 1, Date: "2026-01-10", Payee: "Boundary in" }), // exactly cutoff (maxDate - 7)
        tx({ Id: 2, Date: "2026-01-09", Payee: "Just outside" }), // one day before cutoff
        tx({ Id: 3, Date: "2026-01-17", Payee: "Latest" }), // == maxDate
        tx({ Id: 4, Date: "2026-01-12", Payee: "Middle" }),
      ],
    });
    await renderWithTheme(<Home />);

    const rows = screen.getAllByTestId("tx-row");
    expect(rows.map((r) => r.props.children)).toEqual(["Latest", "Middle", "Boundary in"]);
    expect(screen.queryByText("Just outside")).toBeNull();
  });

  it("Sign out calls AuthProvider's signOut", async () => {
    ready();
    await renderWithTheme(<Home />);
    await fireEvent.press(screen.getByTestId("sign-out-button"));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("Rules opens the rules panel, which closes back to Home", async () => {
    ready();
    await renderWithTheme(<Home />);
    expect(screen.queryByText("rules panel")).toBeNull();

    await fireEvent.press(screen.getByTestId("rules-button"));
    expect(screen.getByText("rules panel")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("rules-panel-close"));
    expect(screen.queryByText("rules panel")).toBeNull();
  });

  it("renders account balances above the recent-activity list", async () => {
    ready({ transactions: [tx()] });
    await renderWithTheme(<Home />);
    expect(screen.getByTestId("account-balances")).toBeTruthy();
    expect(screen.getByText("Recent Activity")).toBeTruthy();
  });

  // Pull-to-refresh used to reload the transaction list only, leaving
  // the balances above it showing whatever the hourly cron last wrote --
  // so the one gesture that means "get me the current state" refreshed
  // half the screen.
  it("pull-to-refresh refreshes the balances as well as the ledger", async () => {
    const refresh = jest.fn(async () => {});
    ready({ transactions: [tx()], refresh });
    await renderWithTheme(<Home />);

    expect(screen.getByTestId("account-balances")).toHaveTextContent("balances:0");

    const list = screen.getByTestId("home-transaction-list");
    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByTestId("account-balances")).toHaveTextContent("balances:1");
  });

  // Home has no answer surface of its own, so a payee/category tap
  // navigates to Ask with the target in the route params -- replace, like
  // every other navigation in this app, so only one screen is ever
  // mounted (see home.tsx for what a pushed Ask would cost).
  it("a row drilldown hands the target over to the Ask screen", async () => {
    ready({ transactions: [tx({ Category: "Groceries" })] });
    await renderWithTheme(<Home />);

    await fireEvent.press(screen.getByTestId("tx-row-drill"));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/ask",
      params: { drillKind: "category", drillValue: "Groceries" },
    });
  });
});
