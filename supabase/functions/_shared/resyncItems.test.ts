import { describe, it, expect, vi, beforeEach } from "vitest";

// The scheduled resync exists to be the thing that still works when the
// webhook path doesn't. Its whole value is in the failure cases -- that
// one broken Item doesn't stop the others, and that a failure is reported
// rather than swallowed into a success-looking result -- so those are what
// this file tests. The sync itself has its own tests; it is mocked here so
// these assertions are about the loop, not the ingest.
const syncItemTransactions = vi.fn();
vi.mock("./syncItemTransactions.ts", () => ({
  syncItemTransactions: (...args: unknown[]) => syncItemTransactions(...args),
}));

const { resyncItems } = await import("./resyncItems.ts");

// A stand-in for the PostgREST builder, matching the one in
// syncItemTransactions.test.ts: every method returns `this`, and the
// object is thenable so `await db.from(...)...` resolves.
function fakeDb(result: { data?: unknown; error?: unknown }) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];

  return {
    calls,
    db: {
      from(table: string) {
        const entry = { table, filters: [] as [string, unknown][] };
        calls.push(entry);
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
            return builder;
          },
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected),
        };
        return builder;
      },
    } as never,
  };
}

const CLIENT = { transactionsSync: vi.fn() } as never;

function items(...ids: string[]) {
  return { data: ids.map((item_id) => ({ item_id })), error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  syncItemTransactions.mockResolvedValue({ added: 0, modified: 0, removed: 0 });
});

describe("resyncItems", () => {
  it("syncs every active item", async () => {
    const { db } = fakeDb(items("item-1", "item-2"));

    await expect(resyncItems(db, CLIENT)).resolves.toEqual({ resynced: 2, failed: 0 });
    expect(syncItemTransactions).toHaveBeenCalledTimes(2);
    expect(syncItemTransactions.mock.calls.map((c) => c[0])).toEqual(["item-1", "item-2"]);
  });

  it("only considers active items", async () => {
    // A disconnected Item's access token is revoked; syncing it would fail
    // on every tick forever and bury a real failure in recurring noise.
    const { db, calls } = fakeDb(items("item-1"));

    await resyncItems(db, CLIENT);

    expect(calls[0].table).toBe("plaid_items");
    expect(calls[0].filters).toEqual([["status", "active"]]);
  });

  it("passes the injected client through, never a default", async () => {
    // test-plaid-link deliberately passes a Plaid *Sandbox* client. If this
    // loop reached for a default production client instead, a scheduled
    // resync would hit the real bank with the wrong credentials.
    const { db } = fakeDb(items("item-1"));

    await resyncItems(db, CLIENT);

    expect(syncItemTransactions).toHaveBeenCalledWith("item-1", CLIENT, db);
  });

  it("keeps going when one item fails, and reports it", async () => {
    // The point of the safety net: one broken bank connection must not
    // stop the others from being synced.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(items("item-1", "item-2", "item-3"));
    syncItemTransactions
      .mockResolvedValueOnce({ added: 1 })
      .mockRejectedValueOnce(new Error("plaid boom"))
      .mockResolvedValueOnce({ added: 2 });

    await expect(resyncItems(db, CLIENT)).resolves.toEqual({ resynced: 2, failed: 1 });
    expect(syncItemTransactions).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a wholly failed run as failed rather than as success", async () => {
    // { resynced: 0, failed: 0 } and { resynced: 0, failed: 2 } must not
    // look alike -- one is "no banks linked", the other is a total outage.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(items("item-1", "item-2"));
    syncItemTransactions.mockRejectedValue(new Error("plaid boom"));

    await expect(resyncItems(db, CLIENT)).resolves.toEqual({ resynced: 0, failed: 2 });
    error.mockRestore();
  });

  it("throws when the item list itself cannot be read", async () => {
    // Failing to even enumerate the items is not "nothing to do" -- a
    // silent 200 here would make a dead safety net look healthy.
    const { db } = fakeDb({ data: null, error: new Error("db down") });

    await expect(resyncItems(db, CLIENT)).rejects.toThrow("db down");
    expect(syncItemTransactions).not.toHaveBeenCalled();
  });

  it("no-ops cleanly when no items are linked", async () => {
    const { db } = fakeDb({ data: null, error: null });

    await expect(resyncItems(db, CLIENT)).resolves.toEqual({ resynced: 0, failed: 0 });
    expect(syncItemTransactions).not.toHaveBeenCalled();
  });

  it("syncs items one at a time rather than all at once", async () => {
    // Plaid rate limits per Item and a sync can page several times per
    // Item; the outage this guards against was already drawing 429s.
    let inFlight = 0;
    let maxInFlight = 0;
    syncItemTransactions.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { added: 0 };
    });
    const { db } = fakeDb(items("item-1", "item-2", "item-3"));

    await resyncItems(db, CLIENT);

    expect(maxInFlight).toBe(1);
  });
});
