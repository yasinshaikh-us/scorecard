import { Pressable, StyleSheet, Text, View } from "react-native";
import { Clock } from "lucide-react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory } from "../lib/logic";
import { iconForCategory } from "../lib/categoryIcons";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import type { DrilldownTarget } from "../lib/drilldown";
import type { Transaction } from "../lib/types";

// Shared by the Home screen's Recent Activity and Ask's QueryCard -- one
// place for how a row looks, so both lists stay in sync.
//
// The two identifying fields are the row's controls: tapping the payee or
// the category badge asks for the last twelve months of that payee or
// that category (see lib/drilldown.ts for the query, and the screens for
// where the answer lands). Amount and date are inert -- they name one
// transaction, and one transaction has nothing to drill into.
//
// This replaced inline editing, which owned the whole row's press. The
// two cannot share it: a row that both edits and queries has to guess
// which one a tap meant, and the fields worth querying are exactly the
// two that used to be editable. Recategorizing lives in the rules panel
// (CategoryRulesPanel), which fixes a merchant everywhere instead of one
// row at a time.
export default function TransactionRow({
  row,
  CATS,
  onDrilldown,
}: {
  row: Transaction;
  CATS: string[];
  onDrilldown?: (target: DrilldownTarget) => void;
}) {
  const { colors, mode } = useTheme();

  const color = catColor(row.Category, CATS, topCategory, mode);
  const Icon = iconForCategory(topCategory(row.Category));
  // Direction, not sentiment: every expense is danger-red and every
  // credit is accent-green, so scanning the column tells you which way
  // money moved without reading a single figure.
  const amountColor = row.Amount < 0 ? colors.danger : colors.accent;

  // Three fixed columns on the top line -- payee (flexes), category
  // (fixed 22), amount (fixed 112) -- so the icons and the decimal points
  // line up down the list however long the payee names are. The date gets
  // the second line to itself.
  return (
    <View testID="transaction-row" style={[styles.row, { borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.topRow}>
        {/* The payee is the tap target rather than a button beside it:
            adding a control per queryable field would put two more glyphs
            on the densest row in the app, and the name IS the thing being
            asked about. No underline or accent colour -- the row has to
            stay a list of transactions first. */}
        <Pressable
          testID="transaction-payee-button"
          style={styles.payeeCol}
          onPress={onDrilldown ? () => onDrilldown({ kind: "payee", value: row.Payee }) : undefined}
          disabled={!onDrilldown}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={row.Payee}
          accessibilityHint="Shows the last 12 months for this payee"
        >
          <Text style={[styles.payee, { color: colors.text, fontFamily: fontFamily.regular }]} numberOfLines={1}>
            {row.Payee}
          </Text>
        </Pressable>
        {/* Icon-only: the name is redundant next to a color-coded glyph
            the user already learns from the chart axis, and dropping it
            is what let the row compress to two tight lines. The label is
            what a screen reader reads instead. */}
        <Pressable
          testID="transaction-category-badge"
          accessibilityRole="button"
          accessibilityLabel={`Category: ${row.Category}`}
          accessibilityHint="Shows the last 12 months for this category"
          onPress={onDrilldown ? () => onDrilldown({ kind: "category", value: row.Category }) : undefined}
          disabled={!onDrilldown}
          hitSlop={8}
          style={styles.categoryCol}
        >
          <Icon size={15} color={color} />
        </Pressable>
        <Text style={[styles.amount, { color: amountColor, fontFamily: fontFamily.mono }]}>{fmtMoney(row.Amount)}</Text>
      </View>
      {/* The date line, and -- for a charge the bank has authorized but
          not yet settled -- a pending marker beside it. It sits here
          rather than by the amount because pending is a fact about the
          transaction's STATE, which is what the date line already
          carries; putting it next to the figure would read as a
          qualifier on the number, which it isn't (the amount of a
          pending charge is normally exactly what posts).

          Glyph plus word, not the glyph alone. The category badge above
          can be icon-only because its color and shape are learned from
          the chart axis and repeat down every row; this appears on a
          minority of rows with nothing to learn it from, so an
          unexplained clock face would just be a mystery mark. */}
      <View style={styles.dateRow}>
        <Text style={[styles.date, { color: colors.textFaint, fontFamily: fontFamily.mono }]}>{fmtDate(row.Date)}</Text>
        {row.Pending ? (
          <View testID="transaction-pending-badge" accessibilityLabel="Pending — not yet posted by the bank" style={styles.pendingBadge}>
            <Clock size={11} color={colors.textMuted} />
            <Text style={[styles.pendingText, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>Pending</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // 15/11, not the 13/10.5 the design pass moved them to. This is the
  // densest text in the app and the only screen most sessions ever see;
  // at 13 the payee and at 10.5 the date both read as fine print on a
  // real phone, whatever they looked like in a mockup. The flex layout
  // around them is unchanged -- only the sizes come back.
  //
  // The flex lives on the Pressable wrapping the payee, not on the Text
  // inside it: an auto-width Pressable would only be tappable across the
  // string's own width, and would stop shrinking a long payee to one
  // line.
  payeeCol: { flex: 1, minWidth: 0 },
  payee: { fontSize: 15 },
  categoryCol: { flexBasis: 22, flexGrow: 0, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  amount: { flexBasis: 112, flexGrow: 0, flexShrink: 0, textAlign: "right", fontSize: 15, fontWeight: "600" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  date: { fontSize: 11 },
  pendingBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  pendingText: { fontSize: 11 },
});
