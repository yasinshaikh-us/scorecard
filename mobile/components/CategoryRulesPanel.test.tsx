import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import CategoryRulesPanel from "./CategoryRulesPanel";

type Rule = {
  id: string;
  priority: number;
  match_field: "payee" | "category";
  match_value: string;
  set_category: string | null;
  set_payee: string | null;
  enabled: boolean;
};

const state: {
  selectResult: { data: Rule[] | null; error: { message: string } | null };
  insertResult: { error: { message: string } | null };
  updateResult: { error: { message: string } | null };
  deleteResult: { error: { message: string } | null };
  rpcResult: { data: number; error: { message: string } | null };
} = {
  selectResult: { data: [], error: null },
  insertResult: { error: null },
  updateResult: { error: null },
  deleteResult: { error: null },
  rpcResult: { data: 0, error: null },
};

const mockInsert = jest.fn((_payload: unknown) => Promise.resolve(state.insertResult));
const mockUpdateEq = jest.fn((_col: string, _val: unknown) => Promise.resolve(state.updateResult));
const mockUpdate = jest.fn((_payload: unknown) => ({ eq: mockUpdateEq }));
const mockDeleteEq = jest.fn((_col: string, _val: unknown) => Promise.resolve(state.deleteResult));
const mockDelete = jest.fn(() => ({ eq: mockDeleteEq }));
const mockOrder = jest.fn(() => Promise.resolve(state.selectResult));
const mockSelect = jest.fn(() => ({ order: mockOrder }));
const mockFrom = jest.fn((_table: string) => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
}));
const mockRpc = jest.fn((_name: string) => Promise.resolve(state.rpcResult));
const mockGetUser = jest.fn(() => Promise.resolve({ data: { user: { id: "user-1" } } }));

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (name: string) => mockRpc(name),
    auth: { getUser: () => mockGetUser() },
  },
}));

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    priority: 100,
    match_field: "payee",
    match_value: "starbucks",
    set_category: "Food:Coffee",
    set_payee: null,
    enabled: true,
    ...overrides,
  };
}

describe("CategoryRulesPanel", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockOrder.mockClear();
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockUpdateEq.mockClear();
    mockDelete.mockClear();
    mockDeleteEq.mockClear();
    mockRpc.mockClear();
    mockGetUser.mockClear();
    state.selectResult = { data: [], error: null };
    state.insertResult = { error: null };
    state.updateResult = { error: null };
    state.deleteResult = { error: null };
    state.rpcResult = { data: 0, error: null };
  });

  it("loads and displays existing rules when opened", async () => {
    state.selectResult = { data: [makeRule()], error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    expect(await screen.findByText(/if payee contains "starbucks"/)).toBeTruthy();
    expect(mockFrom).toHaveBeenCalledWith("category_rules");
  });

  it("shows an empty state with no rules", async () => {
    state.selectResult = { data: [], error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    expect(await screen.findByText("No rules yet.")).toBeTruthy();
  });

  it("rejects adding a rule with no match value", async () => {
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    await screen.findByText("No rules yet.");
    await fireEvent.press(screen.getByText("Add rule"));
    expect(await screen.findByText("Enter a match value and at least one of category/payee to set.")).toBeTruthy();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("adds a rule with the entered match value and reapplies rules", async () => {
    state.rpcResult = { data: 3, error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    await screen.findByText("No rules yet.");

    await fireEvent.changeText(screen.getByPlaceholderText("e.g. starbucks"), "chipotle");
    await fireEvent.changeText(screen.getByPlaceholderText("and payee to (optional)"), "Chipotle Mexican Grill");
    await fireEvent.press(screen.getByText("Add rule"));

    expect(await screen.findByText("Applied to 3 transactions.")).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        match_field: "payee",
        match_value: "chipotle",
        set_category: null,
        set_payee: "Chipotle Mexican Grill",
      })
    );
    expect(mockRpc).toHaveBeenCalledWith("apply_category_rules");
  });

  it("toggling a rule's switch updates enabled and reapplies rules", async () => {
    const rule = makeRule({ enabled: true });
    state.selectResult = { data: [rule], error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    await screen.findByText(/if payee contains "starbucks"/);

    await fireEvent(screen.getByRole("switch"), "valueChange", false);

    expect(mockUpdate).toHaveBeenCalledWith({ enabled: false });
    expect(mockUpdateEq).toHaveBeenCalledWith("id", "rule-1");
    expect(mockRpc).toHaveBeenCalledWith("apply_category_rules");
  });

  it("deleting a rule requires confirmation before calling supabase", async () => {
    state.selectResult = { data: [makeRule()], error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    await screen.findByText(/if payee contains "starbucks"/);

    await fireEvent.press(screen.getByText("🗑"));
    expect(await screen.findByText("Delete this rule?")).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByText("Delete this rule?")).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("confirming delete calls supabase delete scoped to the rule's id, then reapplies", async () => {
    state.selectResult = { data: [makeRule()], error: null };
    await render(<CategoryRulesPanel visible={true} onClose={jest.fn()} />);
    await screen.findByText(/if payee contains "starbucks"/);

    await fireEvent.press(screen.getByText("🗑"));
    await screen.findByText("Delete this rule?");
    await fireEvent.press(screen.getByText("Delete"));

    expect(mockDeleteEq).toHaveBeenCalledWith("id", "rule-1");
    expect(mockRpc).toHaveBeenCalledWith("apply_category_rules");
  });
});
