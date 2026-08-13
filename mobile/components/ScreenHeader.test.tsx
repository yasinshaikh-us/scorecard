import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import ScreenHeader from "./ScreenHeader";

const mockSignOut = jest.fn() as jest.Mock<any>;
jest.mock("../lib/AuthProvider", () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

const mockReplace = jest.fn() as jest.Mock<any>;
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

describe("ScreenHeader", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockReplace.mockReset();
  });

  it("shows the fa/thm brand", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="home" />);
    expect(await screen.findByText("fa/thm")).toBeTruthy();
  });

  it("calls onOpenRules when the Rules button is pressed", async () => {
    const onOpenRules = jest.fn();
    await renderWithTheme(<ScreenHeader onOpenRules={onOpenRules} screen="home" />);
    await fireEvent.press(await screen.findByTestId("rules-button"));
    expect(onOpenRules).toHaveBeenCalled();
  });

  it("calls signOut when the Sign out button is pressed", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="home" />);
    await fireEvent.press(await screen.findByTestId("sign-out-button"));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("renders the theme toggle button", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="home" />);
    expect(await screen.findByTestId("theme-toggle-button")).toBeTruthy();
  });

  // The cross-navigation that replaced the bottom tab bar. Each screen
  // offers only the other one, so the control is never a no-op that
  // navigates to where you already are.
  it("offers Ask from Home, and navigates there", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="home" />);
    expect(screen.queryByTestId("nav-home-button")).toBeNull();
    await fireEvent.press(await screen.findByTestId("nav-ask-button"));
    expect(mockReplace).toHaveBeenCalledWith("/ask");
  });

  it("offers Home from Ask, and navigates there", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="ask" />);
    expect(screen.queryByTestId("nav-ask-button")).toBeNull();
    await fireEvent.press(await screen.findByTestId("nav-home-button"));
    expect(mockReplace).toHaveBeenCalledWith("/home");
  });

  // Every control here is icon-only, so the label is the entire
  // screen-reader surface of the header.
  it("labels every icon-only control", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} screen="home" />);
    for (const [testID, label] of [
      ["rules-button", "Category rules"],
      ["nav-ask-button", "Ask about your spending"],
      ["sign-out-button", "Sign out"],
    ]) {
      expect((await screen.findByTestId(testID)).props.accessibilityLabel).toBe(label);
    }
  });
});
