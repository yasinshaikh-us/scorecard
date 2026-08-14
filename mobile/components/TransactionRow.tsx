import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, ChevronDown, X } from "lucide-react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory } from "../lib/logic";
import { CATEGORIES } from "../lib/categories";
import { iconForCategory } from "../lib/categoryIcons";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import IconButton from "./IconButton";
import PickerModal from "./PickerModal";
import type { Transaction } from "../lib/types";

// Shared by the Home screen's Recent Activity and Ask's QueryCard -- one
// place for how a row looks (and how an edit is saved) so both lists stay
// in sync. Payee/category are the only editable fields (amount/date come
// from the bank), and only rows with a real Id (linked to a
// `transactions` row, not a client-side synthetic one) are editable.
export default function TransactionRow({ row, CATS, onEdited }: { row: Transaction; CATS: string[]; onEdited?: () => void }) {
  const { colors, mode } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draftPayee, setDraftPayee] = useState(row.Payee);
  const [draftCategory, setDraftCategory] = useState(row.Category);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraftPayee(row.Payee);
    setDraftCategory(row.Category);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = draftPayee.trim();
    if (!trimmed) {
      setError("Payee can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    // manually_edited=true so apply_category_rules() and the Plaid sync
    // path both leave this row alone from now on -- otherwise the next
    // rule change (or a later Plaid "modified" update) would silently
    // overwrite this edit.
    const { error: updateError } = await supabase
      .from("transactions")
      .update({ payee: trimmed, category: draftCategory, manually_edited: true })
      .eq("id", row.Id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    row.Payee = trimmed;
    row.Category = draftCategory;
    setEditing(false);
    onEdited?.();
  }

  const DraftIcon = iconForCategory(topCategory(draftCategory));

  if (editing) {
    return (
      <View style={[styles.editingRow, { borderBottomColor: colors.borderSubtle }]}>
        <TextInput
          testID="transaction-edit-payee-input"
          style={[styles.editInput, { borderColor: colors.border, color: colors.text, fontFamily: fontFamily.regular }]}
          value={draftPayee}
          onChangeText={setDraftPayee}
          editable={!saving}
          autoFocus
        />
        {/* The one control here that keeps its words. It is a value being
            chosen, not an action being taken, and the icon alone would
            make the user decode the glyph set to read their own data
            back. Icon plus name, so it still ties to the row's marker. */}
        <Pressable
          testID="transaction-edit-category-button"
          style={[styles.categorySelectBtn, { borderColor: colors.border }]}
          onPress={() => setCategoryPickerOpen(true)}
          disabled={saving}
          accessibilityLabel={`Category: ${draftCategory}`}
        >
          <View style={styles.categorySelectValue}>
            <DraftIcon size={14} color={catColor(draftCategory, CATS, topCategory, mode)} />
            <Text style={[styles.categorySelectText, { color: colors.text, fontFamily: fontFamily.regular }]} numberOfLines={1}>
              {draftCategory}
            </Text>
          </View>
          <ChevronDown size={14} color={colors.textMuted} />
        </Pressable>
        <View style={styles.editActions}>
          <IconButton
            testID="transaction-edit-cancel-button"
            onPress={() => setEditing(false)}
            disabled={saving}
            size={36}
            accessibilityLabel="Discard changes"
          >
            <X size={17} color={colors.textMuted} />
          </IconButton>
          {/* Saving swaps the check for a spinner inside the same circle,
              so the affirmative control never moves or disappears
              mid-save -- the button the thumb is already on stays put. */}
          <IconButton
            testID="transaction-edit-save-button"
            onPress={save}
            disabled={saving}
            size={36}
            variant="accent"
            accessibilityLabel={saving ? "Saving" : "Save changes"}
          >
            {saving ? <ActivityIndicator size="small" color={colors.bg} /> : <Check size={18} color={colors.bg} />}
          </IconButton>
        </View>
        {error ? <Text style={[styles.errorText, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text> : null}
        <PickerModal
          visible={categoryPickerOpen}
          title="Category"
          options={CATEGORIES.map((c) => ({ label: c, value: c }))}
          onSelect={setDraftCategory}
          onClose={() => setCategoryPickerOpen(false)}
        />
      </View>
    );
  }

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
    <Pressable
      testID="transaction-row"
      style={[styles.row, { borderBottomColor: colors.borderSubtle }]}
      onPress={row.Id != null ? startEdit : undefined}
      disabled={row.Id == null}
    >
      <View style={styles.topRow}>
        <Text style={[styles.payee, { color: colors.text, fontFamily: fontFamily.regular }]} numberOfLines={1}>
          {row.Payee}
        </Text>
        {/* Icon-only: the name is redundant next to a color-coded glyph
            the user already learns from the chart axis, and dropping it
            is what let the row compress to two tight lines. The label is
            what a screen reader reads instead. */}
        <View
          testID="transaction-category-badge"
          accessibilityLabel={`Category: ${row.Category}`}
          style={styles.categoryCol}
        >
          <Icon size={15} color={color} />
        </View>
        <Text style={[styles.amount, { color: amountColor, fontFamily: fontFamily.mono }]}>{fmtMoney(row.Amount)}</Text>
      </View>
      <Text style={[styles.date, { color: colors.textFaint, fontFamily: fontFamily.mono }]}>{fmtDate(row.Date)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Column flow (RN's default), not row: editInput/categorySelectBtn's
  // own marginBottom already assumes a vertical stack, but this branch
  // used to reuse the read-only row's flexDirection: "row" wrapper. With
  // a long real payee string (a real Stage 2 run hit "Ach Electronic
  // Creditgusto Pay 123456"), the unconstrained-width TextInput consumed
  // nearly the whole row, pushing editActions (Cancel/Save) off-screen
  // entirely -- confirmed via that run's failure video, which showed the
  // payee input and category button on one line with no Save/Cancel
  // anywhere below or beside them. Never caught by Stage 1's component
  // tests, which use a short payee ("Chipotle") and don't measure real
  // layout/visibility at all.
  editingRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  payee: { flex: 1, minWidth: 0, fontSize: 13 },
  categoryCol: { flexBasis: 22, flexGrow: 0, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  amount: { flexBasis: 112, flexGrow: 0, flexShrink: 0, textAlign: "right", fontSize: 15, fontWeight: "600" },
  date: { fontSize: 10.5, marginTop: 1 },
  editInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, marginBottom: 8 },
  categorySelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  categorySelectValue: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  categorySelectText: { fontSize: 13 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10 },
  errorText: { fontSize: 12, marginTop: 6 },
});
