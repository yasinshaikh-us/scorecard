import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory } from "../lib/logic";
import { CATEGORIES } from "../lib/categories";
import { iconForCategory } from "../lib/categoryIcons";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
import PickerModal from "./PickerModal";
import type { Transaction } from "../lib/types";

// Shared by the Home screen's Recent Activity and Ask's QueryCard, same
// as src/TransactionRow.jsx on the web -- one place for how a row looks
// (and how an edit is saved) so both lists stay in sync. Payee/category
// are the only editable fields (amount/date come from the bank), same as
// the web version -- and only rows with a real Id (linked to a
// `transactions` row, not a client-side synthetic one) are editable.
export default function TransactionRow({ row, CATS, onEdited }: { row: Transaction; CATS: string[]; onEdited?: () => void }) {
  const { colors } = useTheme();
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
        <Pressable
          testID="transaction-edit-category-button"
          style={[styles.categorySelectBtn, { borderColor: colors.border }]}
          onPress={() => setCategoryPickerOpen(true)}
          disabled={saving}
        >
          <Text style={[styles.categorySelectText, { color: colors.text, fontFamily: fontFamily.regular }]} numberOfLines={1}>
            {draftCategory}
          </Text>
        </Pressable>
        <View style={styles.editActions}>
          <Pressable testID="transaction-edit-cancel-button" onPress={() => setEditing(false)} disabled={saving} style={styles.cancelBtn}>
            <Text style={[styles.cancelBtnText, { color: colors.textMuted, fontFamily: fontFamily.medium }]}>Cancel</Text>
          </Pressable>
          <Pressable
            testID="transaction-edit-save-button"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.saveBtnText, { color: colors.bg, fontFamily: fontFamily.semibold }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
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

  const color = catColor(row.Category, CATS, topCategory);
  const Icon = iconForCategory(topCategory(row.Category));
  const amountColor = row.Amount < 0 ? colors.danger : colors.accent;

  return (
    <Pressable
      testID="transaction-row"
      style={[styles.row, { borderBottomColor: colors.borderSubtle }]}
      onPress={row.Id != null ? startEdit : undefined}
      disabled={row.Id == null}
    >
      <View style={styles.main}>
        <Text style={[styles.payee, { color: colors.text, fontFamily: fontFamily.medium }]} numberOfLines={1}>
          {row.Payee}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.categoryBadge, { backgroundColor: color + "26" }]}>
            <Icon size={11} color={color} />
            <Text
              testID="transaction-category-badge"
              style={[styles.categoryText, { color, fontFamily: fontFamily.semibold }]}
              numberOfLines={1}
            >
              {row.Category}
            </Text>
          </View>
          <Text style={[styles.date, { color: colors.textMuted, fontFamily: fontFamily.mono }]}>{fmtDate(row.Date)}</Text>
        </View>
      </View>
      <Text style={[styles.amount, { color: amountColor, fontFamily: fontFamily.mono }]}>{fmtMoney(row.Amount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  main: { flex: 1, marginRight: 12 },
  payee: { fontSize: 15 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 1,
  },
  categoryText: { fontSize: 11 },
  date: { fontSize: 11 },
  amount: { fontSize: 15, fontWeight: "600" },
  editInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, marginBottom: 8 },
  categorySelectBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  categorySelectText: { fontSize: 13 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelBtnText: { fontSize: 13 },
  saveBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  saveBtnText: { fontSize: 13 },
  errorText: { fontSize: 12, marginTop: 6 },
});
