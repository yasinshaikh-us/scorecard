import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import QueryCard from "./QueryCard";
import type { Transaction } from "../lib/types";
import type { QuerySpec } from "../lib/logic";

jest.mock("./Chart", () => {
  const { View: RNView, Pressable: RNPressable, Text: RNText } = require("react-native");
  return function MockChart({ data, spec, selectedKey, onSelect }: any) {
    return (
      <RNView testID="chart" accessibilityLabel={`${spec?.groupBy}/${spec?.chartType}`}>
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

  // The card's answer to "how much did I spend at Chipotle?" used to be a
  // bar and nothing else. These cover the three pieces that changed that:
  // the stat line, the single-bucket re-grouping, and the capped pie's
  // "Other" slice.
  it("leads a result with the total, count and span of the matching rows", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    const rows = [
      tx({ Id: 1, Date: "2026-01-01", Payee: "Chipotle", Amount: -10 }),
      tx({ Id: 2, Date: "2026-03-01", Payee: "Chipotle", Amount: -30 }),
    ];
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "q", spec }} transactions={rows} CATS={["Groceries"]} onRemove={jest.fn()} />
    );

    expect(screen.getByTestId("query-stat-total")).toHaveTextContent("$40.00");
    expect(screen.getByTestId("query-stat-count")).toHaveTextContent("2");
    expect(screen.getByText(/1 Jan 26 – 1 Mar 26/)).toBeTruthy();
  });

  it("re-groups a single-bucket category chart over time instead of drawing one bar", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category", payeeContains: "Chipotle" };
    const rows = [
      tx({ Id: 1, Date: "2026-01-05", Payee: "Chipotle", Category: "Dining:Fast Food", Amount: -10 }),
      tx({ Id: 2, Date: "2026-05-05", Payee: "Chipotle", Category: "Dining:Fast Food", Amount: -20 }),
      tx({ Id: 3, Date: "2026-08-05", Payee: "Chipotle", Category: "Dining:Fast Food", Amount: -30 }),
    ];
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "q", spec }} transactions={rows} CATS={["Dining"]} onRemove={jest.fn()} />
    );

    // month/line, not the category/bar the model asked for.
    expect(screen.getByTestId("chart").props.accessibilityLabel).toBe("month/line");
    expect(screen.getAllByTestId(/^chart-item-/)).toHaveLength(3);
  });

  it("filters the list to every group a capped pie's Other slice stands for", async () => {
    const spec: QuerySpec = { chartType: "pie", groupBy: "category" };
    // Nine categories: five keep their own slice, four fold into Other.
    const rows = Array.from({ length: 9 }, (_, i) =>
      tx({ Id: i + 1, Date: "2026-01-01", Payee: `P${i}`, Category: `Cat${i}:Sub`, Amount: -(i + 1) * 10 })
    );
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "q", spec }} transactions={rows} CATS={[]} onRemove={jest.fn()} />
    );

    await fireEvent.press(screen.getByTestId("chart-item-Other"));
    // Cat0..Cat3 are the four smallest, so those are the rows Other holds.
    expect(screen.getAllByTestId("tx-row").map((r) => r.props.children).sort()).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("caps a huge result set and says how much it is showing", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "month" };
    const transactions = Array.from({ length: 250 }, (_, i) =>
      tx({ Id: i + 1, Date: `2026-0${(i % 8) + 1}-01`, Payee: `P${i}` })
    );
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "everything", spec }} transactions={transactions} CATS={CATS} onRemove={jest.fn()} />
    );

    expect(screen.getAllByTestId("tx-row")).toHaveLength(200);
    expect(screen.getByTestId("query-row-cap")).toHaveTextContent(/showing 200 of 250/);
  });

  it("says nothing about a cap when the whole result fits", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "month" };
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "q", spec }} transactions={[tx()]} CATS={CATS} onRemove={jest.fn()} />
    );
    expect(screen.queryByTestId("query-row-cap")).toBeNull();
  });

  // A spec the app had to correct changes the answer, so the correction
  // is shown rather than applied silently.
  it("names anything normalizeSpec had to drop", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    await renderWithTheme(
      <QueryCard
        card={{ id: 1, question: "q", spec, issues: ["ignored an unreadable start date"] }}
        transactions={[tx()]}
        CATS={CATS}
        onRemove={jest.fn()}
      />
    );
    expect(screen.getByTestId("query-card-issues")).toHaveTextContent(/ignored an unreadable start date/);
  });

  it("shows no correction note for a clean spec", async () => {
    const spec: QuerySpec = { chartType: "bar", groupBy: "category" };
    await renderWithTheme(
      <QueryCard card={{ id: 1, question: "q", spec, issues: [] }} transactions={[tx()]} CATS={CATS} onRemove={jest.fn()} />
    );
    expect(screen.queryByTestId("query-card-issues")).toBeNull();
  });
});
