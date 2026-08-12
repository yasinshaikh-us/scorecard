import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import TransactionRow from "./TransactionRow";
import type { Transaction } from "../lib/types";

type UpdateResult = { error: { message: string } | null };

const mockEq = jest.fn((_col: string, _val: unknown): Promise<UpdateResult> => Promise.resolve({ error: null }));
const mockUpdate = jest.fn((_payload: unknown) => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ update: mockUpdate }));

jest.mock("../lib/supabase", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

function makeRow(overrides: Partial<Transaction> = {}): Transaction {
  return {
    Id: 1,
    Date: "2026-07-22",
    Payee: "Chipotle",
    Category: "Food:Restaurants",
    Amount: -12.5,
    Account: "Checking",
    IsTransfer: false,
    ...overrides,
  };
}

describe("TransactionRow", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockUpdate.mockClear();
    mockEq.mockClear();
  });

  it("renders payee, category, date, and amount", async () => {
    await render(<TransactionRow row={makeRow()} CATS={["Food"]} />);
    expect(screen.getByText("Chipotle")).toBeTruthy();
    expect(screen.getByText("Food:Restaurants")).toBeTruthy();
    expect(screen.getByText("22 Jul 26")).toBeTruthy();
    expect(screen.getByText("-$12.50")).toBeTruthy();
  });

  it("is not pressable when the row has no Id (synthetic row)", async () => {
    await render(<TransactionRow row={makeRow({ Id: undefined as unknown as number })} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    expect(screen.queryByDisplayValue("Chipotle")).toBeNull();
  });

  it("tapping a row enters edit mode with the current payee prefilled", async () => {
    await render(<TransactionRow row={makeRow()} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    expect(screen.getByDisplayValue("Chipotle")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("cancel exits edit mode without saving", async () => {
    await render(<TransactionRow row={makeRow()} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByDisplayValue("Chipotle")).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("save sends the trimmed payee/category with manually_edited:true, scoped to the row's id", async () => {
    const row = makeRow();
    const onEdited = jest.fn();
    await render(<TransactionRow row={row} CATS={[]} onEdited={onEdited} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    await fireEvent.changeText(screen.getByDisplayValue("Chipotle"), "  Chipotle Mexican Grill  ");
    await fireEvent.press(screen.getByText("Save"));

    await screen.findByText("Chipotle Mexican Grill");

    expect(mockFrom).toHaveBeenCalledWith("transactions");
    expect(mockUpdate).toHaveBeenCalledWith({
      payee: "Chipotle Mexican Grill",
      category: "Food:Restaurants",
      manually_edited: true,
    });
    expect(mockEq).toHaveBeenCalledWith("id", 1);
    expect(onEdited).toHaveBeenCalled();
  });

  it("rejects an empty payee without calling supabase", async () => {
    await render(<TransactionRow row={makeRow()} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    await fireEvent.changeText(screen.getByDisplayValue("Chipotle"), "   ");
    await fireEvent.press(screen.getByText("Save"));

    expect(screen.getByText("Payee can't be empty.")).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("shows the update error and stays in edit mode when the save fails", async () => {
    mockEq.mockImplementationOnce(() => Promise.resolve({ error: { message: "network error" } }));
    await render(<TransactionRow row={makeRow()} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    await fireEvent.press(screen.getByText("Save"));

    expect(await screen.findByText("network error")).toBeTruthy();
    expect(screen.getByDisplayValue("Chipotle")).toBeTruthy();
  });

  it("the category picker sets the draft category, saved on Save", async () => {
    const row = makeRow();
    await render(<TransactionRow row={row} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));

    expect(screen.getByTestId("transaction-edit-category-button")).toHaveTextContent("Food:Restaurants");
    await fireEvent.press(screen.getByTestId("transaction-edit-category-button"));
    await fireEvent.press(await screen.findByTestId("picker-option-Dining"));

    expect(screen.getByTestId("transaction-edit-category-button")).toHaveTextContent("Dining");

    await fireEvent.press(screen.getByText("Save"));
    await screen.findByText("Dining");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ category: "Dining" }));
  });

  it("closing the category picker without selecting keeps the previous draft category", async () => {
    await render(<TransactionRow row={makeRow()} CATS={[]} />);
    await fireEvent.press(screen.getByText("Chipotle"));
    await fireEvent.press(screen.getByTestId("transaction-edit-category-button"));
    await screen.findByTestId("picker-options-list");

    await fireEvent.press(screen.getByTestId("picker-cancel-button"));

    expect(screen.getByTestId("transaction-edit-category-button")).toHaveTextContent("Food:Restaurants");
  });
});
