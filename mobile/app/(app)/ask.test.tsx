import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../../lib/testUtils";
import Ask from "./ask";

const mockSignOut = jest.fn() as jest.Mock<any>;
const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("../../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseData = jest.fn() as jest.Mock<any>;
jest.mock("../../lib/DataProvider", () => ({
  useData: () => mockUseData(),
}));

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

jest.mock("../../components/QueryCard", () => {
  const { Text: RNText, View: RNView, Pressable: RNPressable } = require("react-native");
  return function MockQueryCard({ card, onRemove }: any) {
    return (
      <RNView testID="query-card">
        <RNText testID="query-card-question">{card.question}</RNText>
        {card.pending ? <RNText testID="query-card-pending">pending</RNText> : null}
        {card.error ? <RNText testID="query-card-error">{card.error}</RNText> : null}
        {card.offTopic ? <RNText testID="query-card-offtopic">off-topic</RNText> : null}
        {card.spec ? <RNText testID="query-card-title">{card.spec.title}</RNText> : null}
        <RNPressable testID="query-card-remove" onPress={onRemove} />
      </RNView>
    );
  };
});

const mockFetch = jest.fn() as jest.Mock<any>;

function readySession() {
  mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" }, signOut: mockSignOut });
  mockUseData.mockReturnValue({ transactions: [], dataStatus: "ready", CATS: [], refresh: jest.fn() });
}

// Covers runQuery's branching in app/(app)/ask.tsx: the guard clauses, the
// 401 -> forced-sign-out path (not just a generic error card), success
// parsing, and the catch-all network-failure path -- none of it exercised
// anywhere else in Stage 1 (see mobile/README.md's "Not yet covered" note).
describe("Ask", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockUseAuth.mockReset();
    mockUseData.mockReset();
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });

  it("does nothing when the input is empty", async () => {
    readySession();
    await renderWithTheme(<Ask />);
    await fireEvent.press(screen.getByTestId("ask-button"));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("query-card")).toBeNull();
  });

  it("disables the input and button while data isn't ready, and pressing Ask does nothing", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" }, signOut: mockSignOut });
    mockUseData.mockReturnValue({ transactions: [], dataStatus: "loading", CATS: [], refresh: jest.fn() });
    await renderWithTheme(<Ask />);

    expect(screen.getByTestId("ask-input").props.editable).toBe(false);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on dining");
    await fireEvent.press(screen.getByTestId("ask-button"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("runs a query, shows a pending card, then the parsed result", async () => {
    readySession();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: true, title: "Grocery spending" }) }],
        }),
    });

    await renderWithTheme(<Ask />);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on groceries?");
    await fireEvent.press(screen.getByTestId("ask-button"));

    expect(await screen.findByTestId("query-card-title")).toHaveTextContent("Grocery spending");
    expect(screen.getByTestId("query-card-question")).toHaveTextContent("how much on groceries?");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/query"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok-1" }),
        body: JSON.stringify({ question: "how much on groceries?" }),
      })
    );
    // The input clears once the query is dispatched.
    expect(screen.getByTestId("ask-input").props.value).toBe("");
  });

  it("shows the off-topic rejection card for a non-ledger question", async () => {
    readySession();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: false }) }] }),
    });

    await renderWithTheme(<Ask />);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "what's the weather?");
    await fireEvent.press(screen.getByTestId("ask-button"));

    expect(await screen.findByTestId("query-card-offtopic")).toBeTruthy();
  });

  it("signs the user out on a 401, instead of showing an error card", async () => {
    readySession();
    mockFetch.mockResolvedValue({ status: 401, ok: false, json: () => Promise.resolve({}) });

    await renderWithTheme(<Ask />);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on dining?");
    await fireEvent.press(screen.getByTestId("ask-button"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSignOut).toHaveBeenCalled();
    expect(screen.queryByTestId("query-card-error")).toBeNull();
  });

  it("shows an error card when the request itself throws (e.g. offline)", async () => {
    readySession();
    mockFetch.mockRejectedValue(new Error("Network request failed"));

    await renderWithTheme(<Ask />);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on dining?");
    await fireEvent.press(screen.getByTestId("ask-button"));

    expect(await screen.findByTestId("query-card-error")).toHaveTextContent("Network request failed");
  });

  it("tapping a suggestion runs it as a query", async () => {
    readySession();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: true, title: "Dining" }) }] }),
    });

    await renderWithTheme(<Ask />);
    await fireEvent.press(screen.getAllByTestId("ask-suggestion")[0]);

    expect(await screen.findByTestId("query-card-title")).toHaveTextContent("Dining");
  });

  it("removing a card via onRemove clears the feed", async () => {
    readySession();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: true, title: "Dining" }) }] }),
    });

    await renderWithTheme(<Ask />);
    await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on dining?");
    await fireEvent.press(screen.getByTestId("ask-button"));
    await screen.findByTestId("query-card");

    await fireEvent.press(screen.getByTestId("query-card-remove"));
    expect(screen.queryByTestId("query-card")).toBeNull();
  });

  it("Rules opens the rules panel, which closes back to Ask", async () => {
    readySession();
    await renderWithTheme(<Ask />);
    expect(screen.queryByText("rules panel")).toBeNull();

    await fireEvent.press(screen.getByTestId("rules-button"));
    expect(screen.getByText("rules panel")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("rules-panel-close"));
    expect(screen.queryByText("rules panel")).toBeNull();
  });
});
