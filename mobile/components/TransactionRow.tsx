import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fmtDate, fmtMoney } from "../lib/format";
import { catColor } from "../lib/palette";
import { topCategory } from "../lib/logic";
import { CATEGORIES } from "../lib/categories";
import { supabase } from "../lib/supabase";
import PickerModal from "./PickerModal";
import type { Transaction } from "../lib/types";

// Shared by the Home screen's Recent Activity and Ask's QueryCard, same
// as src/TransactionRow.jsx on the web -- one place for how a row looks
// (and how an edit is saved) so both lists stay in sync. Payee/category
// are the only editable fields (amount/date come from the bank), same as
// the web version -- and only rows with a real Id (linked to a
// `transactions` row, not a client-side synthetic one) are editable.
export default function TransactionRow({ row, CATS, onEdited }: { row: Transaction; CATS: string[]; onEdited?: () => void }) {
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
      <View style={styles.row}>
        <TextInput
          testID="transaction-edit-payee-input"
          style={styles.editInput}
          value={draftPayee}
          onChangeText={setDraftPayee}
          editable={!saving}
          autoFocus
        />
        <Pressable
          testID="transaction-edit-category-button"
          style={styles.categorySelectBtn}
          onPress={() => setCategoryPickerOpen(true)}
          disabled={saving}
        >
          <Text style={styles.categorySelectText} numberOfLines={1}>
            {draftCategory}
          </Text>
        </Pressable>
        <View style={styles.editActions}>
          <Pressable testID="transaction-edit-cancel-button" onPress={() => setEditing(false)} disabled={saving} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable testID="transaction-edit-save-button" onPress={save} disabled={saving} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  return (
    <Pressable testID="transaction-row" style={styles.row} onPress={row.Id != null ? startEdit : undefined} disabled={row.Id == null}>
      <View style={styles.main}>
        <Text style={styles.payee} numberOfLines={1}>
          {row.Payee}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.categoryBadge, { backgroundColor: color + "26" }]}>
            <Text testID="transaction-category-badge" style={[styles.categoryText, { color }]} numberOfLines={1}>
              {row.Category}
            </Text>
          </View>
          <Text style={styles.date}>{fmtDate(row.Date)}</Text>
        </View>
      </View>
      <Text style={[styles.amount, row.Amount < 0 && styles.negative]}>{fmtMoney(row.Amount)}</Text>
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
    borderBottomColor: "#eee",
  },
  main: { flex: 1, marginRight: 12 },
  payee: { fontSize: 15, fontWeight: "500" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  categoryBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 },
  categoryText: { fontSize: 11, fontWeight: "600" },
  date: { fontSize: 12, color: "#888" },
  amount: { fontSize: 15, fontWeight: "600" },
  negative: { color: "#d33" },
  editInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, marginBottom: 8 },
  categorySelectBtn: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  categorySelectText: { fontSize: 13 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelBtnText: { color: "#666", fontSize: 13 },
  saveBtn: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  errorText: { color: "#d33", fontSize: 12, marginTop: 6 },
});
