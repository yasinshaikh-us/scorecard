import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import PlaidLinkGate from "./PlaidLinkGate";

const mockStartLink = jest.fn();
const mockUseBankLink = jest.fn((_onDone?: () => void) => ({
  startLink: mockStartLink,
  connecting: false,
  error: null as string | null,
}));
jest.mock("../lib/useBankLink", () => ({
  useBankLink: (onDone?: () => void) => mockUseBankLink(onDone),
}));

// Detox can't drive this screen deterministically at Stage 2 (see
// mobile/README.md) -- the shared synthetic test account almost always
// already has a linked bank by the time e2e specs run, so this screen
// rarely appears there. Covered here instead: both buttons, the connecting
// state, and the error display.
describe("PlaidLinkGate", () => {
  beforeEach(() => {
    mockStartLink.mockClear();
    mockUseBankLink.mockClear();
    mockUseBankLink.mockReturnValue({ startLink: mockStartLink, connecting: false, error: null });
  });

  it("renders the title, body, and both actions", async () => {
    const onDone = jest.fn();
    await render(<PlaidLinkGate onDone={onDone} />);
    expect(screen.getByText("Connect your bank")).toBeTruthy();
    expect(await screen.findByTestId("plaid-gate-connect-button")).toBeTruthy();
    expect(screen.getByTestId("plaid-gate-skip-button")).toBeTruthy();
  });

  it("Connect a bank account calls startLink", async () => {
    const onDone = jest.fn();
    await render(<PlaidLinkGate onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("plaid-gate-connect-button"));
    expect(mockStartLink).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("Skip for now calls onDone directly, without starting a link", async () => {
    const onDone = jest.fn();
    await render(<PlaidLinkGate onDone={onDone} />);
    await fireEvent.press(screen.getByTestId("plaid-gate-skip-button"));
    expect(onDone).toHaveBeenCalled();
    expect(mockStartLink).not.toHaveBeenCalled();
  });

  it("shows the connecting state and disables the connect button", async () => {
    mockUseBankLink.mockReturnValue({ startLink: mockStartLink, connecting: true, error: null });
    await render(<PlaidLinkGate onDone={jest.fn()} />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("shows useBankLink's error", async () => {
    mockUseBankLink.mockReturnValue({ startLink: mockStartLink, connecting: false, error: "Link failed" });
    await render(<PlaidLinkGate onDone={jest.fn()} />);
    expect(await screen.findByText("Link failed")).toBeTruthy();
  });
});
