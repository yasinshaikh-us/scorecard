import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
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

jest.mock("../../components/TransactionRow", () => {
  const { Text: RNText } = require("react-native");
  return function MockTransactionRow({ row }: { row: Transaction }) {
    return <RNText testID="tx-row">{row.Payee}</RNText>;
  };
});

jest.mock("../../components/AccountBalances", () => {
  const { Text: RNText } = require("react-native");
  return function MockAccountBalances() {
    return <RNText testID="account-balances">balances</RNText>;
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
});
