import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../lib/testUtils";
import ScreenHeader from "./ScreenHeader";

const mockSignOut = jest.fn() as jest.Mock<any>;
jest.mock("../lib/AuthProvider", () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

describe("ScreenHeader", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it("shows the fa/thm brand", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} />);
    expect(await screen.findByText("fa/thm")).toBeTruthy();
  });

  it("calls onOpenRules when the Rules button is pressed", async () => {
    const onOpenRules = jest.fn();
    await renderWithTheme(<ScreenHeader onOpenRules={onOpenRules} />);
    await fireEvent.press(await screen.findByTestId("rules-button"));
    expect(onOpenRules).toHaveBeenCalled();
  });

  it("calls signOut when the Sign out button is pressed", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} />);
    await fireEvent.press(await screen.findByTestId("sign-out-button"));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("renders the theme toggle button", async () => {
    await renderWithTheme(<ScreenHeader onOpenRules={jest.fn()} />);
    expect(await screen.findByTestId("theme-toggle-button")).toBeTruthy();
  });
});
