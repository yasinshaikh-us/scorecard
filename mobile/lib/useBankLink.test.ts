import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { useBankLink } from "./useBankLink";

const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("./AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreatePlaidLinkSession = jest.fn() as jest.Mock<any>;
jest.mock("react-native-plaid-link-sdk", () => ({
  createPlaidLinkSession: (config: unknown) => mockCreatePlaidLinkSession(config),
}));

const mockFetch = jest.fn() as jest.Mock<any>;

describe("useBankLink", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockCreatePlaidLinkSession.mockReset();
    mockFetch.mockReset();
    mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" } });
    (global as any).fetch = mockFetch;
  });

  it("does nothing when there's no session", async () => {
    mockUseAuth.mockReturnValue({ session: null });
    const { result } = await renderHook(() => useBankLink());
    await act(async () => {
      await result.current.startLink();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreatePlaidLinkSession).not.toHaveBeenCalled();
  });

  it("fetches a link_token and opens a Plaid Link session with it", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ link_token: "link-tok-1" }),
    });
    mockCreatePlaidLinkSession.mockResolvedValue({ open: jest.fn() });

    const { result } = await renderHook(() => useBankLink());
    await act(async () => {
      await result.current.startLink();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/plaid-link-token"),
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer tok-1" } })
    );
    expect(mockCreatePlaidLinkSession).toHaveBeenCalledWith(expect.objectContaining({ token: "link-tok-1" }));
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error and never opens Link when the link-token fetch fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "no token for you" }),
    });

    const { result } = await renderHook(() => useBankLink());
    await act(async () => {
      await result.current.startLink();
    });

    expect(result.current.error).toBe("no token for you");
    expect(result.current.connecting).toBe(false);
    expect(mockCreatePlaidLinkSession).not.toHaveBeenCalled();
  });

  it("on Link success, exchanges the public_token and calls onLinked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("plaid-link-token")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ link_token: "link-tok-1" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    mockCreatePlaidLinkSession.mockImplementation(async (config: any) => {
      config.onSuccess({ publicToken: "public-tok-1", metadata: {} });
      return { open: jest.fn() };
    });

    const onLinked = jest.fn();
    const { result } = await renderHook(() => useBankLink(onLinked));
    await act(async () => {
      await result.current.startLink();
    });

    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/plaid-exchange"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ public_token: "public-tok-1" }),
      })
    );
    expect(result.current.error).toBeNull();
  });

  it("on Link success, surfaces the server's error when the exchange fails and does not call onLinked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("plaid-link-token")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ link_token: "link-tok-1" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "already connected" }) });
    });
    mockCreatePlaidLinkSession.mockImplementation(async (config: any) => {
      config.onSuccess({ publicToken: "public-tok-1", metadata: {} });
      return { open: jest.fn() };
    });

    const onLinked = jest.fn();
    const { result } = await renderHook(() => useBankLink(onLinked));
    await act(async () => {
      await result.current.startLink();
    });

    await waitFor(() => expect(result.current.error).toBe("already connected"));
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("on Link success, uses a generic error message when the exchange response has no error field", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("plaid-link-token")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ link_token: "link-tok-1" }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    mockCreatePlaidLinkSession.mockImplementation(async (config: any) => {
      config.onSuccess({ publicToken: "public-tok-1", metadata: {} });
      return { open: jest.fn() };
    });

    const { result } = await renderHook(() => useBankLink());
    await act(async () => {
      await result.current.startLink();
    });

    await waitFor(() => expect(result.current.error).toBe("Couldn't finish connecting — try again"));
  });

  it("on Link exit with an error, surfaces the exit error's display message", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ link_token: "link-tok-1" }),
    });
    mockCreatePlaidLinkSession.mockImplementation(async (config: any) => {
      config.onExit({ error: { displayMessage: "User cancelled", errorMessage: "user_cancelled" } });
      return { open: jest.fn() };
    });

    const { result } = await renderHook(() => useBankLink());
    await act(async () => {
      await result.current.startLink();
    });

    expect(result.current.error).toBe("User cancelled");
    expect(result.current.connecting).toBe(false);
  });
});
