import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { functionUrl } from "./functionsClient";
import { cleanRows, computeDataMeta } from "./logic";
import type { Transaction } from "./types";

type DataStatus = "loading" | "ready" | "error";

type DataContextValue = {
  transactions: Transaction[];
  dataStatus: DataStatus;
  CATS: string[];
  refresh: () => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

// Fetches the signed-in user's transactions once (via the `transactions`
// Edge Function) and shares them between Home and Ask, mirroring
// src/App.jsx + src/dataStore.js's pattern -- one fetch, not one per
// screen, and CATS (the category color ordering) derived from the full
// set so a category's color stays stable across different questions.
export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const resp = await fetch(functionUrl("transactions"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error(`Failed to fetch transactions (${resp.status})`);
      const rows = await resp.json();
      setTransactions(cleanRows(rows));
      setDataStatus("ready");
    } catch {
      setDataStatus("error");
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const CATS = useMemo(() => computeDataMeta(transactions).CATS, [transactions]);

  const value = useMemo(() => ({ transactions, dataStatus, CATS, refresh }), [transactions, dataStatus, CATS, refresh]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData() must be called within a DataProvider");
  return ctx;
}
