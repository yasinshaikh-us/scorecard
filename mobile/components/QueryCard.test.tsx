import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import QueryCard from "./QueryCard";
import type { Transaction } from "../lib/types";
import type { QuerySpec } from "../lib/logic";

jest.mock("./Chart", () => {
  const { View: RNView, Pressable: RNPressable, Text: RNText } = require("react-native");
  return function MockChart({ data, selectedKey, onSelect }: any) {
    return (
      <RNView testID="chart">
        {data.map((d: any) => (
          <RNPressable key={d.key} testID={`chart-item-${d.key}`} onPress={() => onSelect(d.key)}>
            <RNText>{selectedKey === d.key ? "selected" : "unselected"}</RNText>
          </RNPressable>
        ))}
      </RNView>
    );
  };
});

jest.mock("./TransactionRow", () => {
  const { Text: RNText } = require("react-native");
  return function MockTransactionRow({ row }: { row: Transaction }) {
    return <RNText testID="tx-row">{row.Payee}</RNText>;
  };
});

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    Id: 1,
    Date: "2026-01-01",
    Payee: "Store",
    Category: "Groceries",
    Amount: -10,
    Account: "Checking",
    IsTransfer: false,
    ...overrides,
  };
}

const CATS = ["Groceries", "Dining"];

describe("QueryCard", () => {
  it("shows the pending state (question + spinner), no chart or rows", async () => {
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "how much on dining?", pending: true }} transactions={[]} CATS={CATS} onRemove={jest.fn()} />
    );
    expect(screen.getByText('"how much on dining?"')).toBeTruthy();
    expect(screen.getByText("thinking…")).toBeTruthy();
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("shows the error state and calls onRemove from its close button", async () => {
    const onRemove = jest.fn();
    await renderWithTheme(
      <QueryCard
        card={{ id: 1, question: "bad query", error: "Request failed" }}
        transactions={[]}
        CATS={CATS}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText(/Couldn't parse that one/)).toBeTruthy();
    expect(screen.getByText(/Request failed/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("query-card-close-button"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows the off-topic rejection state", async () => {
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "weather?", offTopic: true }} transactions={[]} CATS={CATS} onRemove={jest.fn()} />
    );
    expect(screen.getByText(/only answers questions about your own bank-transaction ledger/)).toBeTruthy();
  });

  it("renders nothing for a settled card with no spec (defensive fallback)", async () => {
    await renderWithTheme(<QueryCard card={{ id: 1, question: "?" }} transactions={[]} CATS={CATS} onRemove={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });

  it("groups by category, sorts rows by date descending, and hides the chart when there's no data", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category", title: "Spending" };
    const transactions = [
      tx({ Id: 1, Date: "2026-01-01", Payee: "Early", Category: "Groceries" }),
      tx({ Id: 2, Date: "2026-01-15", Payee: "Late", Category: "Groceries" }),
    ];
    await renderWithTheme(<QueryCard card={{ id: 1, question: "groceries?", spec }} transactions={transactions} CATS={CATS} onRemove={jest.fn()} />);

    expect(screen.getByTestId("chart")).toBeTruthy();
    const rows = screen.getAllByTestId("tx-row");
    expect(rows.map((r) => r.props.children)).toEqual(["Late", "Early"]);
  });

  it("ranks individual transactions (groupBy: transaction) by amount, matching the chart's order, not date order", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "transaction", title: "Top expenses" };
    const transactions = [
      tx({ Id: 1, Date: "2026-01-01", Payee: "Small", Amount: -5 }),
      tx({ Id: 2, Date: "2026-01-15", Payee: "Big", Amount: -50 }),
      tx({ Id: 3, Date: "2026-01-10", Payee: "Medium", Amount: -20 }),
    ];
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "top expenses", spec }} transactions={transactions} CATS={CATS} onRemove={jest.fn()} />
    );

    const rows = screen.getAllByTestId("tx-row");
    expect(rows.map((r) => r.props.children)).toEqual(["Big", "Medium", "Small"]);
  });

  it("selecting a chart key filters the transaction list and shows a clearable filter chip", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category", title: "Spending" };
    const transactions = [
      tx({ Id: 1, Payee: "Groceries item", Category: "Groceries" }),
      tx({ Id: 2, Payee: "Dining item", Category: "Dining" }),
    ];
    await renderWithTheme(<QueryCard card={{ id: 1, question: "spending?", spec }} transactions={transactions} CATS={CATS} onRemove={jest.fn()} />);

    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);

    await fireEvent.press(screen.getByTestId("chart-item-Groceries"));
    expect(screen.getAllByTestId("tx-row")).toHaveLength(1);
    expect(screen.getByTestId("tx-row")).toHaveTextContent("Groceries item");
    expect(screen.getByText(/filtered to/)).toBeTruthy();

    // Tapping the same key again toggles the filter off.
    await fireEvent.press(screen.getByTestId("chart-item-Groceries"));
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
    expect(screen.queryByText(/filtered to/)).toBeNull();
  });

  it("clears the selection via the filter chip's own close control", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category", title: "Spending" };
    const transactions = [tx({ Id: 1, Payee: "Groceries item", Category: "Groceries" })];
    await renderWithTheme(<QueryCard card={{ id: 1, question: "spending?", spec }} transactions={transactions} CATS={CATS} onRemove={jest.fn()} />);

    await fireEvent.press(screen.getByTestId("chart-item-Groceries"));
    expect(screen.getByText(/filtered to/)).toBeTruthy();

    await fireEvent.press(screen.getByText(/filtered to/));
    expect(screen.queryByText(/filtered to/)).toBeNull();
  });

  it("shows the empty state and no chart when chartType is 'none'", async () => {
    const spec: QuerySpec = { chartType: "none", groupBy: "category", title: "Spending" };
    await renderWithTheme(<QueryCard card={{ id: 1, question: "spending?", spec }} transactions={[]} CATS={CATS} onRemove={jest.fn()} />);
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(screen.getByText("No matching transactions")).toBeTruthy();
  });
});
