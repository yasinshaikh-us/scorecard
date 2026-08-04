import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { getSupabaseClient } from "./supabaseClient.js";
import { styles } from "./styles.js";
import { CATEGORIES } from "./categoryIcons.js";

const EMPTY_FORM = { matchField: "payee", matchValue: "", setCategory: "", setPayee: "" };

// Structured rule builder ("if payee/category contains X, set category/
// payee to Y") -- same mental model as an email inbox filter. Rules are
// applied both going forward (in the Plaid sync path) and retroactively
// via the apply_category_rules() Postgres function, which this panel
// calls after every add/edit/delete/toggle so the ledger always reflects
// the current rule set, not just rules added after the fact.
//
// `priority` is still the underlying ordering column (apply_category_rules()
// runs rules in ascending priority order, so a later/higher-priority rule
// overwrites an earlier one's field on conflict), but it's purely an
// implementation detail now -- the UI never shows or asks for a number.
// The list is just top-to-bottom order (ascending priority), and a new
// rule is always appended at the bottom (highest priority, wins conflicts)
// by assigning it a priority higher than every existing rule's.
export default function CategoryRulesPanel({ onClose, onApplied }) {
  const [rules, setRules] = useState(null); // null = loading
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  function loadRules() {
    const supabase = getSupabaseClient();
    return supabase
      .from("category_rules")
      .select("id, priority, match_field, match_value, set_category, set_payee, enabled")
      .order("priority", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        setRules(data || []);
      });
  }

  useEffect(() => {
    loadRules();
  }, []);

  async function reapply() {
    const supabase = getSupabaseClient();
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
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Always appended at the bottom of the list -- the highest priority,
    // so it wins any conflict with an existing rule.
    const nextPriority = rules && rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 10 : 100;
    const { error } = await supabase.from("category_rules").insert({
      user_id: user.id,
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

  async function toggleRule(rule) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("category_rules")
      .update({ enabled: !rule.enabled })
      .eq("id", rule.id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadRules();
    await reapply();
  }

  async function deleteRule(rule) {
    setConfirmDeleteId(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("category_rules").delete().eq("id", rule.id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadRules();
    await reapply();
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <style>{`.rule-delete-btn:hover { color: var(--danger); background: var(--surface-recessed); }`}</style>
      <div style={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeaderRow}>
          <div style={styles.modalTitle}>Rules Engine</div>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

        <div style={styles.ruleDescription}>Rules apply to new and existing transactions.</div>

        <button style={styles.ruleReapplyBtn} onClick={reapply}>
          Reapply now
        </button>

        {rules === null && <div style={styles.ruleEmpty}>Loading…</div>}

        {rules && rules.length > 0 && (
          <div style={styles.ruleListWrap}>
            {rules.map((r) => (
              <div key={r.id} style={styles.ruleRow}>
                {confirmDeleteId === r.id ? (
                  <div style={styles.ruleDeleteConfirm}>
                    <span style={styles.ruleDeleteConfirmText}>Delete this rule?</span>
                    <button onClick={() => setConfirmDeleteId(null)} style={styles.addBankConfirmCancel} autoFocus>
                      Cancel
                    </button>
                    <button onClick={() => deleteRule(r)} style={styles.ruleDeleteConfirmDelete}>
                      Delete
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => toggleRule(r)}
                      style={styles.ruleCheckbox}
                    />
                    <span style={styles.ruleRowText}>
                      if {r.match_field} contains "{r.match_value}"
                      {r.set_category && <> → category {r.set_category}</>}
                      {r.set_payee && <> → payee {r.set_payee}</>}
                    </span>
                    <button
                      onClick={() => setConfirmDeleteId(r.id)}
                      style={styles.ruleDeleteBtn}
                      className="rule-delete-btn"
                      title="Delete rule"
                      aria-label="Delete rule"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {rules && rules.length === 0 && <div style={styles.ruleEmpty}>No rules yet.</div>}

        <div style={styles.ruleFormGrid}>
          <div style={styles.ruleFormLine}>
            If
            <select
              style={styles.formSelect}
              value={form.matchField}
              onChange={(e) => setForm({ ...form, matchField: e.target.value })}
            >
              <option value="payee">Payee</option>
              <option value="category">Category</option>
            </select>
            contains
            <input
              style={styles.formInput}
              placeholder="e.g. starbucks"
              value={form.matchValue}
              onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
            />
          </div>
          <div style={styles.ruleFormLine}>
            set category to
            <select
              style={styles.formSelect}
              value={form.setCategory}
              onChange={(e) => setForm({ ...form, setCategory: e.target.value })}
            >
              <option value="">(no change)</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            and payee to
            <input
              style={styles.formInput}
              placeholder="(optional)"
              value={form.setPayee}
              onChange={(e) => setForm({ ...form, setPayee: e.target.value })}
            />
          </div>
          <div style={styles.ruleFormLine}>
            <span style={{ fontSize: 11 }}>New rules are added at the bottom of the list and win any conflict with rules above them.</span>
            <button style={styles.askBtn} onClick={addRule} disabled={saving}>
              {saving ? "Saving…" : "Add rule"}
            </button>
          </div>
        </div>

        {status && <div style={styles.ruleStatus}>{status}</div>}
        {error && <div style={styles.ruleError}>{error}</div>}
      </div>
    </div>
  );
}
