import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MessageCircleQuestion } from "lucide-react-native";
import { useAuth } from "../../lib/AuthProvider";
import { useData } from "../../lib/DataProvider";
import { useTheme } from "../../lib/ThemeProvider";
import { fontFamily } from "../../lib/theme";
import { functionUrl } from "../../lib/functionsClient";
import { parseQueryResponse, type QueryResult } from "../../lib/logic";
import QueryCard from "../../components/QueryCard";
import RisingSuggestions from "../../components/RisingSuggestions";
import ScreenHeader from "../../components/ScreenHeader";
import CategoryRulesPanel from "../../components/CategoryRulesPanel";

// Idle-state suggestions. Rendered by RisingSuggestions as a slow upward
// drift of bare text, scattered left/centre/right -- see that component
// for why they are not chips.
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

// The Ask flow: a text
// question goes to the `query` Edge Function (the only place the
// Anthropic key is used), the response is parsed into a filter/chart
// spec, and that spec is applied client-side against the already-fetched
// transactions from DataProvider (shared with Home) -- the server never
// sees the actual ledger data for this call, only the question.
export default function Ask() {
  const { session, signOut } = useAuth();
  const { transactions, dataStatus, CATS, refresh } = useData();
  const { colors } = useTheme();

  const [input, setInput] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
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
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={["top"]}>
      <ScreenHeader onOpenRules={() => setRulesOpen(true)} screen="ask" />

      {/* The send control sits inside the field rather than beside it, so
          the bar itself runs the full width of the screen instead of
          surrendering ~70px to a button. It is the Ask glyph with no fill:
          a filled accent slab next to an input reads as the heaviest thing
          on an otherwise quiet screen, and this is a control beside an
          input rather than an action that closes a task. */}
      <View style={styles.queryBar}>
        <View style={[styles.field, { borderColor: colors.border }]}>
          <TextInput
            testID="ask-input"
            style={[styles.input, { color: colors.text, fontFamily: fontFamily.regular }]}
            placeholderTextColor={colors.textFaint}
            value={input}
            onChangeText={setInput}
            placeholder={dataStatus === "ready" ? "Ask about your spending…" : "Loading…"}
            editable={dataStatus === "ready"}
            onSubmitEditing={() => runQuery(input)}
            returnKeyType="send"
          />
          <Pressable
            testID="ask-button"
            style={styles.askBtn}
            onPress={() => runQuery(input)}
            disabled={loading || dataStatus !== "ready"}
            hitSlop={10}
            accessibilityLabel="Ask"
          >
            {loading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <MessageCircleQuestion
                size={18}
                color={dataStatus === "ready" ? colors.textMuted : colors.textFaint}
              />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.feed} keyboardShouldPersistTaps="handled">
        {cards.length === 0 && (
          <RisingSuggestions suggestions={SUGGESTIONS} disabled={dataStatus !== "ready"} onPick={runQuery} />
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

      <CategoryRulesPanel visible={rulesOpen} onClose={() => setRulesOpen(false)} onApplied={refresh} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  queryBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 10,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 15 },
  askBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  feed: { flexGrow: 1, paddingBottom: 24 },
});
