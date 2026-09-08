import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import TransactionRow from "./TransactionRow";
import type { DrilldownTarget } from "../lib/drilldown";
import type { Transaction } from "../lib/types";

function makeRow(overrides: Partial<Transaction> = {}): Transaction {
  return {
    Id: 1,
    Date: "2026-07-22",
    Payee: "Chipotle",
    Category: "Food:Restaurants",
    Amount: -12.5,
    Account: "Checking",
    IsTransfer: false,
    Pending: false,
    ...overrides,
  };
}

describe("TransactionRow", () => {
  it("renders payee, category, date, and amount", async () => {
    await renderWithTheme(<TransactionRow row={makeRow()} CATS={["Food"]} />);
    expect(screen.getByText("Chipotle")).toBeTruthy();
    expect(screen.getByText("22 Jul 26")).toBeTruthy();
    expect(screen.getByText("-$12.50")).toBeTruthy();
    // The category is an icon now, with no visible name -- so the only
    // thing naming it is the label a screen reader would announce.
    expect(screen.getByTestId("transaction-category-badge").props.accessibilityLabel).toBe("Category: Food:Restaurants");
  });

  // Pending transactions were always reaching the ledger -- Plaid's sync
  // stream includes them and this app never filtered them out -- but
  // nothing distinguished an authorized charge from a settled one, so a
  // figure that can still change looked exactly like one that can't.
  describe("pending", () => {
    it("marks a pending row beside its date", async () => {
      await renderWithTheme(<TransactionRow row={makeRow({ Pending: true })} CATS={["Food"]} />);
      expect(screen.getByTestId("transaction-pending-badge")).toBeTruthy();
      expect(screen.getByText("Pending")).toBeTruthy();
      // The date is still there: pending qualifies the date line, it does
      // not replace it.
      expect(screen.getByText("22 Jul 26")).toBeTruthy();
    });

    it("says nothing on a settled row", async () => {
      await renderWithTheme(<TransactionRow row={makeRow()} CATS={["Food"]} />);
      expect(screen.queryByTestId("transaction-pending-badge")).toBeNull();
      expect(screen.queryByText("Pending")).toBeNull();
    });

    // The glyph is not left to speak for itself. The category badge above
    // can be icon-only -- its color and shape repeat on every row and are
    // learned from the chart axis -- but this appears on a minority of
    // rows with nothing to learn it from, so it carries the word too, and
    // a label that says what it means to a screen reader.
    it("explains itself in words, not by glyph alone", async () => {
      await renderWithTheme(<TransactionRow row={makeRow({ Pending: true })} CATS={["Food"]} />);
      const badge = screen.getByTestId("transaction-pending-badge");
      expect(badge.props.accessibilityLabel).toBe("Pending — not yet posted by the bank");
    });

    // The amount is unqualified on purpose: what posts is normally
    // exactly what was authorized, so pending is a fact about the
    // transaction's state, not a caveat on its figure.
    it("leaves the amount and category untouched", async () => {
      await renderWithTheme(<TransactionRow row={makeRow({ Pending: true })} CATS={["Food"]} />);
      expect(screen.getByText("-$12.50")).toBeTruthy();
      expect(screen.getByTestId("transaction-category-badge").props.accessibilityLabel).toBe(
        "Category: Food:Restaurants"
      );
    });

    it("still drills down", async () => {
      const onDrilldown = jest.fn();
      await renderWithTheme(
        <TransactionRow row={makeRow({ Pending: true })} CATS={["Food"]} onDrilldown={onDrilldown} />
      );
      await fireEvent.press(screen.getByTestId("transaction-payee-button"));
      expect(onDrilldown).toHaveBeenCalledWith({ kind: "payee", value: "Chipotle" });
    });
  });

  describe("drilldown", () => {
    it("tapping the payee asks for that payee", async () => {
      const onDrilldown = jest.fn<(t: DrilldownTarget) => void>();
      await renderWithTheme(<TransactionRow row={makeRow()} CATS={[]} onDrilldown={onDrilldown} />);
      await fireEvent.press(screen.getByTestId("transaction-payee-button"));
      expect(onDrilldown).toHaveBeenCalledWith({ kind: "payee", value: "Chipotle" });
    });

    // The row's own full category, subcategory and all -- narrowing it to
    // the top level is buildDrilldown's job, not the row's, so the row
    // stays the one place that knows what it is displaying.
    it("tapping the category badge asks for that category", async () => {
      const onDrilldown = jest.fn<(t: DrilldownTarget) => void>();
      await renderWithTheme(<TransactionRow row={makeRow()} CATS={[]} onDrilldown={onDrilldown} />);
      await fireEvent.press(screen.getByTestId("transaction-category-badge"));
      expect(onDrilldown).toHaveBeenCalledWith({ kind: "category", value: "Food:Restaurants" });
    });

    // A row with no Id is a client-side synthetic one, which used to be
    // the reason a row wasn't tappable (there was nothing to UPDATE). A
    // drilldown writes nothing and reads only the payee and category, so
    // the distinction no longer applies.
    it("works on a row with no Id", async () => {
      const onDrilldown = jest.fn<(t: DrilldownTarget) => void>();
      await renderWithTheme(
        <TransactionRow row={makeRow({ Id: undefined as unknown as number })} CATS={[]} onDrilldown={onDrilldown} />
      );
      await fireEvent.press(screen.getByTestId("transaction-payee-button"));
      expect(onDrilldown).toHaveBeenCalledWith({ kind: "payee", value: "Chipotle" });
    });

    it("is inert with no handler, rather than swallowing the tap", async () => {
      await renderWithTheme(<TransactionRow row={makeRow()} CATS={[]} />);
      expect(screen.getByTestId("transaction-payee-button").props.accessibilityState?.disabled).toBe(true);
      expect(screen.getByTestId("transaction-category-badge").props.accessibilityState?.disabled).toBe(true);
      // No throw, no handler, nothing to assert beyond the row surviving
      // a press it has nowhere to send.
      await fireEvent.press(screen.getByTestId("transaction-payee-button"));
      expect(screen.getByText("Chipotle")).toBeTruthy();
    });

    // The amount and date name one transaction, so there is nothing to
    // drill into from them -- and a whole-row press would have to guess
    // which of the two queries a tap meant.
    it("announces both targets as buttons, and says what they do", async () => {
      await renderWithTheme(<TransactionRow row={makeRow()} CATS={[]} onDrilldown={jest.fn()} />);
      const payee = screen.getByTestId("transaction-payee-button");
      expect(payee.props.accessibilityRole).toBe("button");
      expect(payee.props.accessibilityLabel).toBe("Chipotle");
      expect(payee.props.accessibilityHint).toBe("Shows the last 12 months for this payee");
      const badge = screen.getByTestId("transaction-category-badge");
      expect(badge.props.accessibilityRole).toBe("button");
      expect(badge.props.accessibilityHint).toBe("Shows the last 12 months for this category");
    });
  });
});
