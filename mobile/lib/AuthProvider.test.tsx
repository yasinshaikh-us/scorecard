import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { AuthProvider, useAuth } from "./AuthProvider";

const mockGetSession = jest.fn() as jest.Mock<any>;
const mockOnAuthStateChange = jest.fn() as jest.Mock<any>;
const mockSignInWithOAuth = jest.fn() as jest.Mock<any>;
const mockExchangeCodeForSession = jest.fn() as jest.Mock<any>;
const mockSetSession = jest.fn() as jest.Mock<any>;
const mockSignOut = jest.fn() as jest.Mock<any>;

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      signInWithOAuth: (...args: any[]) => mockSignInWithOAuth(...args),
      exchangeCodeForSession: (...args: any[]) => mockExchangeCodeForSession(...args),
      setSession: (...args: any[]) => mockSetSession(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
    },
  },
}));

const mockMakeRedirectUri = jest.fn(() => "fathom://redirect") as jest.Mock<any>;
jest.mock("expo-auth-session", () => ({
  makeRedirectUri: (...args: any[]) => mockMakeRedirectUri(...args),
}));

const mockOpenAuthSessionAsync = jest.fn() as jest.Mock<any>;
jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: (...args: any[]) => mockOpenAuthSessionAsync(...args),
}));

const mockFetch = jest.fn() as jest.Mock<any>;

function makeSession(overrides: Record<string, unknown> = {}) {
  return { access_token: "at-1", refresh_token: "rt-1", user: { id: "user-1" }, ...overrides };
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockOnAuthStateChange.mockReset();
    mockSignInWithOAuth.mockReset();
    mockExchangeCodeForSession.mockReset();
    mockSetSession.mockReset();
    mockSignOut.mockReset();
    mockMakeRedirectUri.mockClear();
    mockOpenAuthSessionAsync.mockReset();
    mockFetch.mockReset();

    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    (global as any).fetch = mockFetch;
  });

  it("starts loading, then resolves to no session when there's none stored", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it("resolves the stored session on load", async () => {
    const session = makeSession();
    mockGetSession.mockResolvedValue({ data: { session } });
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toEqual(session);
  });

  it("updates session when onAuthStateChange fires", async () => {
    let capturedCallback: ((event: string, session: unknown) => void) | undefined;
    mockOnAuthStateChange.mockImplementation((cb: any) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newSession = makeSession({ access_token: "at-2" });
    await act(async () => {
      capturedCallback?.("SIGNED_IN", newSession);
    });

    await waitFor(() => expect(result.current.session).toEqual(newSession));
  });

  it("signInWithGoogle exchanges the redirect's code for a session on success", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com/auth" }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: "fathom://redirect?code=abc123" });
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "fathom://redirect", skipBrowserRedirect: true },
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("signInWithGoogle does nothing (no throw) when the user cancels the browser session", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com/auth" }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "cancel" });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signInWithGoogle();
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("signInWithGoogle throws when Supabase returns no OAuth URL", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signInWithGoogle()).rejects.toThrow("Supabase didn't return an OAuth URL");
  });

  it("signInWithGoogle throws when the redirect has no authorization code", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com/auth" }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: "fathom://redirect" });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signInWithGoogle()).rejects.toThrow("No authorization code in the OAuth redirect");
  });

  it("signInWithGoogle rethrows a signInWithOAuth error", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: new Error("oauth broke") });

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signInWithGoogle()).rejects.toThrow("oauth broke");
  });

  // The enabled-build happy path lives in AuthProvider.testLoginEnabled.test.tsx --
  // TEST_LOGIN_ENABLED is computed once at module-load time from
  // process.env.EXPO_PUBLIC_ENABLE_TEST_LOGIN (matching how EAS actually
  // bakes this flag in at build time, see eas.json), which is unset in
  // this file's ambient test environment same as a production build, so
  // this exercises exactly that "disabled" case.
  it("signInWithTestAccount throws in a build without test login enabled", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.signInWithTestAccount()).rejects.toThrow("Test login isn't enabled in this build.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("signOut calls supabase's signOut", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalled();
  });
});
