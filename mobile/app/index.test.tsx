import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import Index from "./index";

const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("../lib/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("expo-router", () => {
  const { Text: RNText } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
  };
});

// Entry route: must never flash the login screen for an already-signed-in
// user on cold start, so it has to wait out the session-restore check
// before redirecting anywhere.
describe("Index", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it("shows a spinner (no redirect yet) while the session is still restoring", async () => {
    mockUseAuth.mockReturnValue({ session: null, loading: true });
    await render(<Index />);
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("redirects to /home once loading finishes with a session", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok" }, loading: false });
    await render(<Index />);
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/home");
  });

  it("redirects to /login once loading finishes with no session", async () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false });
    await render(<Index />);
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/login");
  });
});
