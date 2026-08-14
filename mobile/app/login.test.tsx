import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { StyleSheet } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme, TEST_METRICS } from "../lib/testUtils";
import Login from "./login";

const mockSignInWithGoogle = jest.fn() as jest.Mock<any>;
const mockSignInWithTestAccount = jest.fn() as jest.Mock<any>;
const mockUseAuth = jest.fn() as jest.Mock<any>;
const authState = { TEST_LOGIN_ENABLED: false };
jest.mock("../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
  get TEST_LOGIN_ENABLED() {
    return authState.TEST_LOGIN_ENABLED;
  },
}));

jest.mock("expo-router", () => {
  const { Text: RNText } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
  };
});

function notSignedIn() {
  mockUseAuth.mockReturnValue({
    session: null,
    signInWithGoogle: mockSignInWithGoogle,
    signInWithTestAccount: mockSignInWithTestAccount,
  });
}

describe("Login", () => {
  beforeEach(() => {
    mockSignInWithGoogle.mockReset();
    mockSignInWithTestAccount.mockReset();
    mockUseAuth.mockReset();
    authState.TEST_LOGIN_ENABLED = false;
  });

  it("redirects to /home when already signed in, instead of showing the login screen", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, signInWithGoogle: mockSignInWithGoogle, signInWithTestAccount: mockSignInWithTestAccount });
    await renderWithTheme(<Login />);
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/home");
    expect(screen.queryByTestId("google-signin-button")).toBeNull();
  });

  it("hides the test-login button in a build without test login enabled", async () => {
    notSignedIn();
    await renderWithTheme(<Login />);
    expect(screen.getByTestId("google-signin-button")).toBeTruthy();
    expect(screen.queryByTestId("test-signin-button")).toBeNull();
  });

  it("shows the test-login button when test login is enabled", async () => {
    authState.TEST_LOGIN_ENABLED = true;
    notSignedIn();
    await renderWithTheme(<Login />);
    expect(screen.getByTestId("test-signin-button")).toBeTruthy();
  });

  it("Continue with Google calls signInWithGoogle and shows its error on failure", async () => {
    notSignedIn();
    mockSignInWithGoogle.mockRejectedValue(new Error("popup closed"));
    await renderWithTheme(<Login />);

    await fireEvent.press(screen.getByTestId("google-signin-button"));
    expect(mockSignInWithGoogle).toHaveBeenCalled();
    expect(await screen.findByText("popup closed")).toBeTruthy();
  });

  it("shows a fallback message when signInWithGoogle throws a non-Error", async () => {
    notSignedIn();
    mockSignInWithGoogle.mockRejectedValue("weird failure");
    await renderWithTheme(<Login />);

    await fireEvent.press(screen.getByTestId("google-signin-button"));
    expect(await screen.findByText("Couldn't sign in — try again")).toBeTruthy();
  });

  it("Sign in as test user calls signInWithTestAccount and shows its error on failure", async () => {
    authState.TEST_LOGIN_ENABLED = true;
    notSignedIn();
    mockSignInWithTestAccount.mockRejectedValue(new Error("bad secret"));
    await renderWithTheme(<Login />);

    await fireEvent.press(screen.getByTestId("test-signin-button"));
    expect(mockSignInWithTestAccount).toHaveBeenCalled();
    expect(await screen.findByText("bad secret")).toBeTruthy();
  });

  // Regression: a real Stage 2 screenshot showed the version rendered
  // under the navigation bar's home indicator and the theme toggle drawn
  // over the status bar's battery icon. This screen is a plain centred
  // View, so both absolutely-positioned elements have to add the insets
  // themselves -- flattened here because the style is an array.
  it("keeps the version and theme toggle clear of the system bars", async () => {
    notSignedIn();
    await renderWithTheme(<Login />);

    const version = StyleSheet.flatten(screen.getByTestId("app-version").props.style);
    expect(version.bottom).toBe(TEST_METRICS.insets.bottom + 18);

    const toggle = StyleSheet.flatten(screen.getByTestId("theme-toggle-button").parent!.props.style);
    expect(toggle.top).toBe(TEST_METRICS.insets.top + 20);
  });

  it("clears a previous error on a fresh attempt", async () => {
    notSignedIn();
    mockSignInWithGoogle.mockRejectedValueOnce(new Error("first failure"));
    await renderWithTheme(<Login />);

    await fireEvent.press(screen.getByTestId("google-signin-button"));
    await screen.findByText("first failure");

    mockSignInWithGoogle.mockResolvedValueOnce(undefined);
    await fireEvent.press(screen.getByTestId("google-signin-button"));
    await waitFor(() => expect(screen.queryByText("first failure")).toBeNull());
  });
});
