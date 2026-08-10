// Separate file, deliberately: AuthProvider.tsx's TEST_LOGIN_ENABLED is
// computed once at module-load time from
// process.env.EXPO_PUBLIC_ENABLE_TEST_LOGIN (matching how EAS bakes this
// flag in at build time -- see eas.json's development/preview profiles).
// Jest gives each test *file* its own fresh module registry, so setting
// the env vars here before requiring AuthProvider is enough to exercise
// the enabled build -- no jest.resetModules() needed (that would also
// reset React itself mid-file and break hooks, since AuthProvider.test.tsx
// already exercises the ambient-disabled case via a normal static import).
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react-native";

// `import` statements are hoisted above all other code by the ESM->CJS
// transform, so setting these before a static `import` of AuthProvider
// wouldn't actually run first -- using require() below (a plain function
// call, not hoisted) is what makes the ordering real.
process.env.EXPO_PUBLIC_ENABLE_TEST_LOGIN = "true";
process.env.EXPO_PUBLIC_TEST_LOGIN_SECRET = "shh";

const mockGetSession = jest.fn() as jest.Mock<any>;
const mockOnAuthStateChange = jest.fn() as jest.Mock<any>;
const mockSetSession = jest.fn() as jest.Mock<any>;
const mockFetch = jest.fn() as jest.Mock<any>;

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: (...args: any[]) => mockSetSession(...args),
      signOut: jest.fn(),
    },
  },
}));

jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn(() => "fathom://redirect") }));
jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn(), openAuthSessionAsync: jest.fn() }));

const { AuthProvider, useAuth } = require("./AuthProvider");

describe("AuthProvider (test login enabled build)", () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    mockSetSession.mockReset();
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });

  it("posts the secret and sets the returned session", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "test-at", refresh_token: "test-rt" }),
    });
    mockSetSession.mockResolvedValue({ error: null });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signInWithTestAccount();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/test-login"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ secret: "shh" }),
      })
    );
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: "test-at", refresh_token: "test-rt" });
  });

  it("throws the server's error when the request fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "bad secret" }),
    });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signInWithTestAccount()).rejects.toThrow("bad secret");
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});
