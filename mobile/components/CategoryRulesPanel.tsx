import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { CATEGORIES } from "../lib/categories";
import { useTheme } from "../lib/ThemeProvider";
import { fontFamily } from "../lib/theme";
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

// The rules engine UI: "if payee/category contains X, set
// category/payee to Y" rules, applied both going forward (the Plaid sync
// path) and retroactively via the apply_category_rules() Postgres
// function, called after every add/edit/delete/toggle. `priority` is an
// implementation detail (ascending order = the list's top-to-bottom
// order; a new rule always gets appended at the bottom, winning any
// conflict with rules above it) -- the UI never shows or asks for a
// number.
export default function CategoryRulesPanel({ visible, onClose, onApplied }: { visible: boolean; onClose: () => void; onApplied?: () => void }) {
  const { colors } = useTheme();
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
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text, fontFamily: fontFamily.bold }]}>Rules Engine</Text>
          <Pressable testID="rules-close-button" onPress={onClose} hitSlop={8}>
            <Text style={[styles.close, { color: colors.textMuted }]}>×</Text>
          </Pressable>
        </View>
        <Text style={[styles.description, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>
          Rules apply automatically to new and existing transactions.
        </Text>

        <ScrollView style={{ flex: 1 }}>
          {rules === null && <ActivityIndicator style={{ marginTop: 20 }} color={colors.accent} />}

          {rules && rules.length === 0 && (
            <Text style={[styles.empty, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>No rules yet.</Text>
          )}

          {rules?.map((r) => (
            <View key={r.id} style={[styles.ruleRow, { borderBottomColor: colors.borderSubtle }]}>
              {confirmDeleteId === r.id ? (
                <View style={styles.deleteConfirmRow}>
                  <Text style={[styles.deleteConfirmText, { color: colors.text, fontFamily: fontFamily.regular }]}>
                    Delete this rule?
                  </Text>
                  <Pressable
                    testID="rule-delete-cancel-button"
                    onPress={() => setConfirmDeleteId(null)}
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.text, fontFamily: fontFamily.medium }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    testID="rule-delete-confirm-button"
                    onPress={() => deleteRule(r)}
                    style={[styles.deleteBtn, { backgroundColor: colors.danger }]}
                  >
                    <Text style={[styles.deleteBtnText, { color: colors.bg, fontFamily: fontFamily.semibold }]}>Delete</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Switch
                    testID="rule-switch-toggle"
                    value={r.enabled}
                    onValueChange={() => toggleRule(r)}
                    trackColor={{ true: colors.accent, false: colors.border }}
                  />
                  <Text style={[styles.ruleText, { color: colors.text, fontFamily: fontFamily.regular }]}>
                    if {r.match_field} contains "{r.match_value}"
                    {r.set_category ? ` → category ${r.set_category}` : ""}
                    {r.set_payee ? ` → payee ${r.set_payee}` : ""}
                  </Text>
                  <Pressable testID="rule-delete-button" onPress={() => setConfirmDeleteId(r.id)} hitSlop={8}>
                    <Trash2 size={15} color={colors.textFaint} />
                  </Pressable>
                </>
              )}
            </View>
          ))}

          <View style={[styles.form, { backgroundColor: colors.surfaceRecessed }]}>
            <View style={styles.formLine}>
              <Text style={[styles.formLabel, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>If</Text>
              <Pressable
                testID="rule-match-field-button"
                style={[styles.selectBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setMatchFieldPickerOpen(true)}
              >
                <Text style={[styles.selectBtnText, { color: colors.text, fontFamily: fontFamily.regular }]}>
                  {form.matchField === "payee" ? "Payee" : "Category"}
                </Text>
              </Pressable>
              <Text style={[styles.formLabel, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>contains</Text>
            </View>
            <TextInput
              testID="rule-match-value-input"
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontFamily: fontFamily.regular }]}
              placeholder="e.g. starbucks"
              placeholderTextColor={colors.textFaint}
              value={form.matchValue}
              onChangeText={(v) => setForm({ ...form, matchValue: v })}
            />

            <View style={styles.formLine}>
              <Text style={[styles.formLabel, { color: colors.textMuted, fontFamily: fontFamily.regular }]}>set category to</Text>
              <Pressable
                testID="rule-category-select-button"
                style={[styles.selectBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setCategoryPickerOpen(true)}
              >
                <Text style={[styles.selectBtnText, { color: colors.text, fontFamily: fontFamily.regular }]}>
                  {form.setCategory || "(no change)"}
                </Text>
              </Pressable>
            </View>
            <TextInput
              testID="rule-set-payee-input"
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontFamily: fontFamily.regular }]}
              placeholder="and payee to (optional)"
              placeholderTextColor={colors.textFaint}
              value={form.setPayee}
              onChangeText={(v) => setForm({ ...form, setPayee: v })}
            />

            <Text style={[styles.hint, { color: colors.textFaint, fontFamily: fontFamily.regular }]}>
              New rules are added at the bottom of the list and win any conflict with rules above them.
            </Text>
            <Pressable
              testID="add-rule-button"
              style={[styles.addBtn, { backgroundColor: colors.accent }, saving && styles.disabled]}
              onPress={addRule}
              disabled={saving}
            >
              <Text style={[styles.addBtnText, { color: colors.bg, fontFamily: fontFamily.semibold }]}>
                {saving ? "Saving…" : "Add rule"}
              </Text>
            </Pressable>
          </View>

          {status ? (
            <Text testID="rules-status" style={[styles.status, { color: colors.accent, fontFamily: fontFamily.regular }]}>
              {status}
            </Text>
          ) : null}
          {error ? <Text style={[styles.error, { color: colors.danger, fontFamily: fontFamily.regular }]}>{error}</Text> : null}
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
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18 },
  close: { fontSize: 24 },
  description: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  empty: { marginTop: 20, textAlign: "center" },
  ruleRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  ruleText: { flex: 1, fontSize: 13 },
  deleteConfirmRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  deleteConfirmText: { flex: 1, fontSize: 13 },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: 7 },
  cancelBtnText: { fontSize: 13 },
  deleteBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  deleteBtnText: { fontSize: 13 },
  form: { marginTop: 16, gap: 8, borderRadius: 10, padding: 14 },
  formLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  formLabel: { fontSize: 13 },
  selectBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flex: 1 },
  selectBtnText: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  hint: { fontSize: 11 },
  addBtn: { borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  disabled: { opacity: 0.5 },
  addBtnText: { fontSize: 14 },
  status: { fontSize: 13, marginTop: 10 },
  error: { fontSize: 13, marginTop: 10, marginBottom: 20 },
});
