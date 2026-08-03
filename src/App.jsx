import { useState, useRef, useEffect } from "react";
import { Home as HomeIcon, MessageCircleQuestion, Filter, LogOut } from "lucide-react";
import { styles } from "./styles.js";
import ThemeToggle from "./ThemeToggle.jsx";
import Login from "./Login.jsx";
import PlaidLinkGate from "./PlaidLinkGate.jsx";
import CategoryRulesPanel from "./CategoryRulesPanel.jsx";
import HomePage from "./HomePage.jsx";
import AskPage from "./AskPage.jsx";
import { getSupabaseClient } from "./supabaseClient.js";
import { loadData } from "./dataStore.js";
import { cleanRows, parseQueryResponse } from "./logic.js";

const PATH_FOR_PAGE = { home: "/", ask: "/ask" };
const pageForPathname = (pathname) => (pathname === "/ask" ? "ask" : "home");

// Top-level authenticated shell: persistent header/nav + whichever page is
// active, plus the Rules modal that can be opened from any page. Owns all
// the state a page might need (transaction data, the Ask feed) so moving
// between pages never re-fetches or loses the in-progress feed.
//
// Navigation is hand-rolled (pushState/popstate) rather than a router
// library -- there are only three destinations (Home, Ask, the Rules
// modal), and this extends the same pattern already proven for the Rules
// modal's back-button behavior. Nav items render as real <a> tags (not
// buttons) so Cmd/Ctrl-click and "open in new tab" work like normal
// navigation even though the actual navigation is handled in JS.
function AuthedApp({ accessToken, onSignOut }) {
  const [page, setPage] = useState(() => pageForPathname(window.location.pathname));
  const [showRules, setShowRules] = useState(() => window.location.hash === "#rules");

  const [input, setInput] = useState("");
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const nextId = useRef(0);

  const [transactions, setTransactions] = useState([]);
  const [dataStatus, setDataStatus] = useState("loading"); // "loading" | "ready" | "error"

  // Seed a matching history entry for whatever the browser actually loaded
  // (a direct link to /ask, a refresh with #rules still in the URL, ...)
  // so the very first popstate (e.g. the first Back press) has real state
  // to read instead of null.
  useEffect(() => {
    window.history.replaceState(
      { page, rulesOpen: showRules },
      "",
      PATH_FOR_PAGE[page] + (showRules ? "#rules" : "")
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onPopState(e) {
      setPage(e.state?.page || "home");
      setShowRules(!!e.state?.rulesOpen);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPage) {
    if (nextPage === page) return;
    window.history.pushState({ page: nextPage }, "", PATH_FOR_PAGE[nextPage]);
    setPage(nextPage);
  }

  function openRules() {
    window.history.pushState({ page, rulesOpen: true }, "", PATH_FOR_PAGE[page] + "#rules");
    setShowRules(true);
  }
  function closeRules() {
    if (window.history.state?.rulesOpen) {
      window.history.back();
    } else {
      setShowRules(false);
    }
  }

  function refreshTransactions() {
    return fetch("/api/transactions", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch transactions (${res.status})`);
        return res.json();
      })
      .then((rows) => {
        const cleaned = cleanRows(rows);
        loadData(cleaned);
        setTransactions(cleaned);
        setDataStatus("ready");
      })
      .catch(() => setDataStatus("error"));
  }

  useEffect(() => {
    refreshTransactions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runQuery(q) {
    if (!q.trim() || loading || dataStatus !== "ready") return;
    setLoading(true);
    const id = nextId.current++;
    setCards([{ id, question: q, spec: null, error: null, pending: true }]);
    setInput("");
    try {
      const resp = await fetch("/api/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ question: q }),
      });
      if (resp.status === 401) {
        // A stale/expired token isn't something rephrasing the question
        // fixes — drop back to the sign-in screen instead of showing a
        // confusing error card.
        onSignOut();
        return;
      }
      const data = await resp.json();
      const result = parseQueryResponse(resp.ok, data);
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...result, pending: false } : c)));
    } catch (e) {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, error: String(e.message || e), pending: false } : c)));
    } finally {
      setLoading(false);
    }
  }

  // Home's shortcut pills jump to Ask and immediately run a canned
  // question through the exact same pipeline the input bar uses.
  function askAndGo(question) {
    navigate("ask");
    runQuery(question);
  }

  return (
    <div style={styles.page}>
      <style>{`
        ::placeholder { color: var(--text-faint); }
        button:disabled { opacity: 0.3; cursor: default; }
        .tx-row:hover { background: var(--surface-recessed); }
        .recharts-wrapper *:focus:not(:focus-visible) { outline: none; }
      `}</style>

      <div style={styles.header}>
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); navigate("home"); }}
          style={{ ...styles.brand, cursor: "pointer", textDecoration: "none", color: "inherit" }}
        >
          fa/thm
        </a>
        <div style={styles.navRow}>
          <a
            href="/"
            onClick={(e) => { e.preventDefault(); navigate("home"); }}
            title="Home"
            aria-label="Home"
            style={{ ...styles.navIconBtn, ...(page === "home" ? styles.navIconBtnActive : {}) }}
          >
            <HomeIcon size={17} />
          </a>
          <a
            href="/ask"
            onClick={(e) => { e.preventDefault(); navigate("ask"); }}
            title="Ask"
            aria-label="Ask"
            style={{ ...styles.navIconBtn, ...(page === "ask" ? styles.navIconBtnActive : {}) }}
          >
            <MessageCircleQuestion size={17} />
          </a>
          <a
            href="#rules"
            onClick={(e) => { e.preventDefault(); openRules(); }}
            title="Rules"
            aria-label="Rules"
            style={styles.navIconBtn}
          >
            <Filter size={17} />
          </a>
          <button onClick={onSignOut} title="Sign out" aria-label="Sign out" style={styles.navIconBtn}>
            <LogOut size={17} />
          </button>
          <ThemeToggle />
        </div>
      </div>

      {showRules && (
        <CategoryRulesPanel
          onClose={closeRules}
          onApplied={refreshTransactions}
        />
      )}

      {dataStatus === "loading" && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, fontFamily: "var(--font-body)" }}>
          Loading transaction data…
        </div>
      )}
      {dataStatus === "error" && (
        <div style={{ textAlign: "center", color: "var(--danger)", fontSize: 13, fontFamily: "var(--font-body)" }}>
          Couldn't load transaction data — check the Supabase connection.
        </div>
      )}

      {page === "home" ? (
        <HomePage transactions={transactions} dataStatus={dataStatus} onAskShortcut={askAndGo} />
      ) : (
        <AskPage
          input={input}
          onInputChange={setInput}
          onAsk={() => runQuery(input)}
          loading={loading}
          dataStatus={dataStatus}
          cards={cards}
          onRemoveCard={(id) => setCards((prev) => prev.filter((c) => c.id !== id))}
        />
      )}
    </div>
  );
}

// Top-level auth gate: renders the dashboard once signed in, otherwise
// the Google sign-in screen. All actual data isolation happens server-side
// (RLS on `transactions`, keyed off the access token forwarded to
// api/transactions.js) — this is just what decides which screen to show.
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  // undefined = checking, null = no linked bank yet, object = at least one plaid_items row
  const [plaidItem, setPlaidItem] = useState(undefined);
  const [skippedLink, setSkippedLink] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setPlaidItem(undefined);
      return;
    }
    const supabase = getSupabaseClient();
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .limit(1)
      .then(({ data, error }) => {
        // Fail open: an unreachable/broken link-status check shouldn't
        // block the dashboard. `false` is a distinct "unknown" sentinel
        // from null ("confirmed: no linked bank"), so it never triggers
        // the Link gate below.
        if (error) {
          console.error("Failed to check plaid_items", error);
          setPlaidItem(false);
          return;
        }
        setPlaidItem(data?.[0] ?? null);
      })
      .catch((err) => {
        console.error("Failed to check plaid_items", err);
        setPlaidItem(false);
      });
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (plaidItem === undefined) return null; // checking for a linked bank

  if (plaidItem === null && !skippedLink) {
    return (
      <PlaidLinkGate
        accessToken={session.access_token}
        onDone={() => setSkippedLink(true)}
      />
    );
  }

  return (
    <AuthedApp
      accessToken={session.access_token}
      onSignOut={() => getSupabaseClient().auth.signOut()}
    />
  );
}
