import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/AuthProvider";
import { useData } from "../../lib/DataProvider";
import { functionUrl } from "../../lib/functionsClient";
import { parseQueryResponse, type QueryResult } from "../../lib/logic";
import QueryCard from "../../components/QueryCard";

// Same idle-state suggestions as src/AskPage.jsx, minus the floating CSS
// animation (no straightforward RN equivalent without pulling in
// Reanimated) -- shown as a static tappable list instead until that's
// worth adding.
const SUGGESTIONS = [
  "How much did I spend on dining last month?",
  "What's my biggest expense this year?",
  "Top 10 expenses this month",
  "How much did I spend at Chipotle?",
  "What's my average grocery purchase?",
  "Which category do I spend the most on?",
  "Show me my recent transactions",
  "How much have I spent this month?",
];

type Card = { id: number; question: string; pending?: boolean } & Partial<QueryResult>;

// Mirrors src/App.jsx's runQuery + src/AskPage.jsx/QueryCard.jsx: a text
// question goes to the `query` Edge Function (the only place the
// Anthropic key is used), the response is parsed into a filter/chart
// spec, and that spec is applied client-side against the already-fetched
// transactions from DataProvider (shared with Home) -- the server never
// sees the actual ledger data for this call, only the question.
export default function Ask() {
  const { session, signOut } = useAuth();
  const { transactions, dataStatus, CATS, refresh } = useData();

  const [input, setInput] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const nextId = useRef(0);

  async function runQuery(question: string) {
    const q = question.trim();
    if (!q || loading || dataStatus !== "ready" || !session) return;
    setLoading(true);
    const id = nextId.current++;
    setCards([{ id, question: q, pending: true }]);
    setInput("");
    try {
      const resp = await fetch(functionUrl("query"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: q }),
      });
      if (resp.status === 401) {
        // A stale/expired token isn't something rephrasing the question
        // fixes -- drop back to the sign-in screen instead of showing a
        // confusing error card.
        await signOut();
        return;
      }
      const data = await resp.json();
      const result = parseQueryResponse(resp.ok, data);
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...result, pending: false } : c)));
    } catch (e) {
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, error: e instanceof Error ? e.message : String(e), pending: false } : c))
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.queryBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={dataStatus === "ready" ? "Ask about your spending…" : "Loading…"}
          editable={dataStatus === "ready"}
          onSubmitEditing={() => runQuery(input)}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.askBtn, (loading || dataStatus !== "ready") && styles.askBtnDisabled]}
          onPress={() => runQuery(input)}
          disabled={loading || dataStatus !== "ready"}
        >
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.askBtnText}>Ask</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.feed} keyboardShouldPersistTaps="handled">
        {cards.length === 0 && (
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                style={styles.suggestion}
                disabled={dataStatus !== "ready"}
                onPress={() => runQuery(s)}
              >
                <Text style={styles.suggestionText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {cards.map((c) => (
          <QueryCard
            key={c.id}
            card={c}
            transactions={transactions}
            CATS={CATS}
            onRemove={() => setCards((prev) => prev.filter((x) => x.id !== c.id))}
            onTransactionEdited={refresh}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  queryBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  askBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  askBtnDisabled: { opacity: 0.4 },
  askBtnText: { color: "#fff", fontWeight: "600" },
  feed: { paddingBottom: 24 },
  suggestions: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  suggestion: { paddingVertical: 6 },
  suggestionText: { color: "#999", fontSize: 14, fontStyle: "italic" },
});
