import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { DataProvider, useData } from "./DataProvider";

const mockUseAuth = jest.fn() as jest.Mock<any>;
jest.mock("./AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockFetch = jest.fn() as jest.Mock<any>;

function Consumer() {
  const { transactions, dataStatus, CATS } = useData();
  return (
    <>
      <Text>status:{dataStatus}</Text>
      <Text>count:{transactions.length}</Text>
      <Text>cats:{CATS.join(",")}</Text>
    </>
  );
}

describe("DataProvider", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });

  it("stays loading and doesn't fetch when there's no session", async () => {
    mockUseAuth.mockReturnValue({ session: null });
    await render(
      <DataProvider>
        <Consumer />
      </DataProvider>
    );
    expect(screen.getByText("status:loading")).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches, cleans, and exposes transactions + derived CATS when signed in", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { Id: 1, Date: "2026-01-01", Payee: "Store", Category: "Shopping:Clothes", Amount: -10 },
          { Id: 2, Date: "2026-01-02", Payee: "Job", Category: "Income", Amount: 500 },
        ]),
    });

    await render(
      <DataProvider>
        <Consumer />
      </DataProvider>
    );

    expect(await screen.findByText("status:ready")).toBeTruthy();
    expect(screen.getByText("count:2")).toBeTruthy();
    expect(screen.getByText("cats:Shopping,Income")).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/transactions"),
      expect.objectContaining({ headers: { Authorization: "Bearer tok-1" } })
    );
  });

  it("sets status to error when the response isn't ok", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" } });
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await render(
      <DataProvider>
        <Consumer />
      </DataProvider>
    );
    expect(await screen.findByText("status:error")).toBeTruthy();
  });

  it("sets status to error when fetch itself rejects", async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: "tok-1" } });
    mockFetch.mockRejectedValue(new Error("network down"));
    await render(
      <DataProvider>
        <Consumer />
      </DataProvider>
    );
    expect(await screen.findByText("status:error")).toBeTruthy();
  });
});
