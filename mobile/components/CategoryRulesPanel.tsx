import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { CATEGORIES } from "../lib/categories";
import PickerModal from "./PickerModal";

type Rule = {
  id: string;
  priority: number;
  match_field: "payee" | "category";
  match_value: string;
  set_category: string | null;
  set_payee: string | null;
  enabled: boolean;
};
const EMPTY_FORM = { matchField: "payee" as "payee" | "category", matchValue: "", setCategory: "", setPayee: "" };

// Ports src/CategoryRulesPanel.jsx: "if payee/category contains X, set
// category/payee to Y" rules, applied both going forward (the Plaid sync
// path) and retroactively via the apply_category_rules() Postgres
// function, called after every add/edit/delete/toggle. `priority` is an
// implementation detail (ascending order = the list's top-to-bottom
// order; a new rule always gets appended at the bottom, winning any
// conflict with rules above it) -- the UI never shows or asks for a
// number.
export default function CategoryRulesPanel({ visible, onClose, onApplied }: { visible: boolean; onClose: () => void; onApplied?: () => void }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [matchFieldPickerOpen, setMatchFieldPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  function loadRules() {
    return supabase
      .from("category_rules")
      .select("id, priority, match_field, match_value, set_category, set_payee, enabled")
      .order("priority", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        setRules((data as Rule[]) || []);
      });
  }

  useEffect(() => {
    if (visible) loadRules();
  }, [visible]);

  async function reapply() {
    const { data, error } = await supabase.rpc("apply_category_rules");
    if (error) {
      setError(error.message);
      return;
    }
    setStatus(`Applied to ${data} transaction${data === 1 ? "" : "s"}.`);
    onApplied?.();
  }

  async function addRule() {
    if (!form.matchValue.trim() || (!form.setCategory.trim() && !form.setPayee.trim())) {
      setError("Enter a match value and at least one of category/payee to set.");
      return;
    }
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const nextPriority = rules && rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 10 : 100;
    const { error } = await supabase.from("category_rules").insert({
      user_id: user!.id,
      priority: nextPriority,
      match_field: form.matchField,
      match_value: form.matchValue.trim(),
      set_category: form.setCategory.trim() || null,
      set_payee: form.setPayee.trim() || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    await loadRules();
    await reapply();
  }

  async function toggleRule(rule: Rule) {
    const { error } = await supabase.from("category_rules").update({ enabled: !rule.enabled }).eq("id", rule.id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadRules();
    await reapply();
  }

  async function deleteRule(rule: Rule) {
    setConfirmDeleteId(null);
    const { error } = await supabase.from("category_rules").delete().eq("id", rule.id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadRules();
    await reapply();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Rules Engine</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.description}>Rules apply automatically to new and existing transactions.</Text>

        <ScrollView style={{ flex: 1 }}>
          {rules === null && <ActivityIndicator style={{ marginTop: 20 }} />}

          {rules && rules.length === 0 && <Text style={styles.empty}>No rules yet.</Text>}

          {rules?.map((r) => (
            <View key={r.id} style={styles.ruleRow}>
              {confirmDeleteId === r.id ? (
                <View style={styles.deleteConfirmRow}>
                  <Text style={styles.deleteConfirmText}>Delete this rule?</Text>
                  <Pressable onPress={() => setConfirmDeleteId(null)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={() => deleteRule(r)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Switch value={r.enabled} onValueChange={() => toggleRule(r)} />
                  <Text style={styles.ruleText}>
                    if {r.match_field} contains "{r.match_value}"
                    {r.set_category ? ` → category ${r.set_category}` : ""}
                    {r.set_payee ? ` → payee ${r.set_payee}` : ""}
                  </Text>
                  <Pressable onPress={() => setConfirmDeleteId(r.id)} hitSlop={8}>
                    <Text style={styles.trash}>🗑</Text>
                  </Pressable>
                </>
              )}
            </View>
          ))}

          <View style={styles.form}>
            <View style={styles.formLine}>
              <Text style={styles.formLabel}>If</Text>
              <Pressable style={styles.selectBtn} onPress={() => setMatchFieldPickerOpen(true)}>
                <Text style={styles.selectBtnText}>{form.matchField === "payee" ? "Payee" : "Category"}</Text>
              </Pressable>
              <Text style={styles.formLabel}>contains</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="e.g. starbucks"
              value={form.matchValue}
              onChangeText={(v) => setForm({ ...form, matchValue: v })}
            />

            <View style={styles.formLine}>
              <Text style={styles.formLabel}>set category to</Text>
              <Pressable style={styles.selectBtn} onPress={() => setCategoryPickerOpen(true)}>
                <Text style={styles.selectBtnText}>{form.setCategory || "(no change)"}</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              placeholder="and payee to (optional)"
              value={form.setPayee}
              onChangeText={(v) => setForm({ ...form, setPayee: v })}
            />

            <Text style={styles.hint}>New rules are added at the bottom of the list and win any conflict with rules above them.</Text>
            <Pressable style={[styles.addBtn, saving && styles.disabled]} onPress={addRule} disabled={saving}>
              <Text style={styles.addBtnText}>{saving ? "Saving…" : "Add rule"}</Text>
            </Pressable>
          </View>

          {status ? <Text style={styles.status}>{status}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>

      <PickerModal
        visible={matchFieldPickerOpen}
        title="If"
        options={[
          { label: "Payee", value: "payee" },
          { label: "Category", value: "category" },
        ]}
        onSelect={(v) => setForm({ ...form, matchField: v as "payee" | "category" })}
        onClose={() => setMatchFieldPickerOpen(false)}
      />
      <PickerModal
        visible={categoryPickerOpen}
        title="Set category to"
        options={[{ label: "(no change)", value: "" }, ...CATEGORIES.map((c) => ({ label: c, value: c }))]}
        onSelect={(v) => setForm({ ...form, setCategory: v })}
        onClose={() => setCategoryPickerOpen(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff", paddingTop: 56, paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "700" },
  close: { fontSize: 24, color: "#888" },
  description: { fontSize: 13, color: "#888", marginTop: 4, marginBottom: 12 },
  empty: { color: "#888", marginTop: 20, textAlign: "center" },
  ruleRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee", gap: 8 },
  ruleText: { flex: 1, fontSize: 13 },
  trash: { fontSize: 16 },
  deleteConfirmRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  deleteConfirmText: { flex: 1, fontSize: 13 },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelBtnText: { color: "#666", fontSize: 13 },
  deleteBtn: { backgroundColor: "#d33", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  deleteBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  form: { marginTop: 16, gap: 8 },
  formLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  formLabel: { fontSize: 13, color: "#444" },
  selectBtn: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flex: 1 },
  selectBtnText: { fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  hint: { fontSize: 11, color: "#999" },
  addBtn: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  disabled: { opacity: 0.5 },
  addBtnText: { color: "#fff", fontWeight: "600" },
  status: { color: "#2a8a4a", fontSize: 13, marginTop: 10 },
  error: { color: "#d33", fontSize: 13, marginTop: 10, marginBottom: 20 },
});
