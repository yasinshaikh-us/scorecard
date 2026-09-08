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

// The Home screen hands a payee/category tap over as route params (see
// home.tsx's openDrilldown), so the params are this screen's input for
// that path and have to be controllable here. useRouter is mocked
// alongside them only because ScreenHeader (rendered unmocked below)
// navigates with it.
const mockParams = jest.fn() as jest.Mock<any>;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
  return function MockQueryCard({ card, onRemove, onDrilldown }: any) {
    return (
      <RNView testID="query-card">
        <RNText testID="query-card-question">{card.question}</RNText>
        {card.pending ? <RNText testID="query-card-pending">pending</RNText> : null}
        {card.error ? <RNText testID="query-card-error">{card.error}</RNText> : null}
        {card.offTopic ? <RNText testID="query-card-offtopic">off-topic</RNText> : null}
        {card.spec ? <RNText testID="query-card-title">{card.spec.title}</RNText> : null}
        {card.spec ? <RNText testID="query-card-payee-exact">{String(card.spec.payeeExact)}</RNText> : null}
        {card.spec ? <RNText testID="query-card-date-start">{String(card.spec.dateStart)}</RNText> : null}
        <RNPressable testID="query-card-remove" onPress={onRemove} />
        {/* Stands in for a row inside the card's own list asking the next
            question. */}
        <RNPressable testID="query-card-drill-payee" onPress={() => onDrilldown?.({ kind: "payee", value: "Safeway" })} />
      </RNView>
    );
  };
});

const mockFetch = jest.fn() as jest.Mock<any>;

const LEDGER = [
  { Id: 1, Date: "2026-09-08", Payee: "Chipotle", Category: "Food:Restaurants", Amount: -12.5, Account: "Checking", IsTransfer: false, Pending: false },
];

function readySession(transactions: any[] = []) {
  mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" }, signOut: mockSignOut });
  mockUseData.mockReturnValue({ transactions, dataStatus: "ready", CATS: [], refresh: jest.fn() });
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
    mockParams.mockReset();
    mockParams.mockReturnValue({});
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

  // A tap on a payee or category is answered here without a round trip:
  // the spec is built locally (lib/drilldown.ts), so there is no pending
  // card, no fetch, and nothing for the model to get wrong.
  describe("drilldowns", () => {
    it("answers a payee handed over in the route params, without calling the query function", async () => {
      readySession(LEDGER);
      mockParams.mockReturnValue({ drillKind: "payee", drillValue: "Chipotle" });

      await renderWithTheme(<Ask />);

      expect(await screen.findByTestId("query-card-title")).toHaveTextContent("All activity at Chipotle");
      expect(screen.getByTestId("query-card-question")).toHaveTextContent("Chipotle — last 12 months");
      expect(screen.getByTestId("query-card-payee-exact")).toHaveTextContent("Chipotle");
      // Anchored to the ledger's own last date, not the device clock.
      expect(screen.getByTestId("query-card-date-start")).toHaveTextContent("2025-09-08");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(screen.queryByTestId("query-card-pending")).toBeNull();
    });

    it("answers a category the same way, widened to its top level", async () => {
      readySession(LEDGER);
      mockParams.mockReturnValue({ drillKind: "category", drillValue: "Food:Restaurants" });

      await renderWithTheme(<Ask />);

      expect(await screen.findByTestId("query-card-title")).toHaveTextContent("All Food activity");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // Nothing this app writes duplicates a param, but a URL can.
    it("takes the first value when a param arrives repeated", async () => {
      readySession(LEDGER);
      mockParams.mockReturnValue({ drillKind: ["payee"], drillValue: ["Chipotle", "Safeway"] });

      await renderWithTheme(<Ask />);
      expect(await screen.findByTestId("query-card-title")).toHaveTextContent("All activity at Chipotle");
    });

    it("ignores params that name no drilldown, and an unknown kind", async () => {
      readySession(LEDGER);
      mockParams.mockReturnValue({ drillKind: "account", drillValue: "Checking" });
      await renderWithTheme(<Ask />);
      expect(screen.queryByTestId("query-card")).toBeNull();

      mockParams.mockReturnValue({ drillKind: "payee" });
      await renderWithTheme(<Ask />);
      expect(screen.queryByTestId("query-card")).toBeNull();
    });

    // The window counts back from the ledger's last date, so running
    // before the ledger has loaded would date it from nothing.
    it("waits for the ledger before answering", async () => {
      mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" }, signOut: mockSignOut });
      mockUseData.mockReturnValue({ transactions: [], dataStatus: "loading", CATS: [], refresh: jest.fn() });
      mockParams.mockReturnValue({ drillKind: "payee", drillValue: "Chipotle" });

      await renderWithTheme(<Ask />);
      expect(screen.queryByTestId("query-card")).toBeNull();
    });

    // Dismissing the card must not re-run the param it came from: the
    // param is still in the URL, and a re-render for any other reason
    // would otherwise put the card straight back.
    it("does not re-answer the same param after the card is dismissed", async () => {
      readySession(LEDGER);
      mockParams.mockReturnValue({ drillKind: "payee", drillValue: "Chipotle" });

      await renderWithTheme(<Ask />);
      await screen.findByTestId("query-card");
      await fireEvent.press(screen.getByTestId("query-card-remove"));

      expect(screen.queryByTestId("query-card")).toBeNull();
    });

    it("a drilldown from inside a card replaces the feed with the next question", async () => {
      readySession(LEDGER);
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ isLedgerQuery: true, title: "Dining" }) }] }),
      });

      await renderWithTheme(<Ask />);
      await fireEvent.changeText(screen.getByTestId("ask-input"), "how much on dining?");
      await fireEvent.press(screen.getByTestId("ask-button"));
      expect(await screen.findByTestId("query-card-title")).toHaveTextContent("Dining");

      await fireEvent.press(screen.getByTestId("query-card-drill-payee"));

      expect(screen.getAllByTestId("query-card")).toHaveLength(1);
      expect(screen.getByTestId("query-card-title")).toHaveTextContent("All activity at Safeway");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
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
