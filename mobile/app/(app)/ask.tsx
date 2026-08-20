import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { SUGGESTIONS, pickSuggestions } from "../../lib/suggestions";

// Which idle-state suggestions this visit shows. The pool lives in
// lib/suggestions.ts (fifty of them, covering every question shape the
// app can answer); a random handful is drawn per mount, because fifty
// drifting up the screen at once is noise and a fixed eight is what made
// the app look narrower than it is.
const SHOWN_SUGGESTIONS = 8;

type Card = { id: number; question: string; pending?: boolean } & Partial<QueryResult>;

// The Ask flow: a text
// question goes to the `query` Edge Function (the only place the
// Anthropic key is used), the response is parsed into a filter/chart
// spec, and that spec is applied client-side against the already-fetched
// transactions from DataProvider (shared with Home) -- the server never
// sees the actual ledger data for this call, only the question.
export default function Ask() {
  const { session, signOut } = useAuth();
  // Sampled once per mount, not per render: re-drawing them on every
  // keystroke would reshuffle the screen under the reader.
  const suggestions = useMemo(() => pickSuggestions(SUGGESTIONS, SHOWN_SUGGESTIONS), []);
  const { transactions, dataStatus, CATS, refresh } = useData();
  const { colors } = useTheme();
  // Same reason as Home: nothing reserves the navigation bar's space now
  // that the tab bar is gone.
  const insets = useSafeAreaInsets();

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

      <ScrollView
        // Named for Stage 2: a result card is taller than the screen
        // once its list has rows, and anything below the chart is
        // unreachable to a test that cannot scroll this. Unused by the
        // specs today only because the monitor account's ledger is empty
        // (see e2e/appFlows.test.js).
        testID="ask-feed"
        contentContainerStyle={[styles.feed, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {cards.length === 0 && (
          <RisingSuggestions suggestions={suggestions} disabled={dataStatus !== "ready"} onPick={runQuery} />
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
  feed: { flexGrow: 1 },
});
