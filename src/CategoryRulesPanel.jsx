import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { getSupabaseClient } from "./supabaseClient.js";
import { styles } from "./styles.js";

const EMPTY_FORM = { matchField: "payee", matchValue: "", setCategory: "", setPayee: "", priority: 100 };

// Structured rule builder ("if payee/category contains X, set category/
// payee to Y") -- same mental model as an email inbox filter. Rules are
// applied both going forward (in the Plaid sync path) and retroactively
// via the apply_category_rules() Postgres function, which this panel
// calls after every add/edit/delete/toggle so the ledger always reflects
// the current rule set, not just rules added after the fact.
export default function CategoryRulesPanel({ onClose, onApplied }) {
  const [rules, setRules] = useState(null); // null = loading
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

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
    const { error } = await supabase.from("category_rules").insert({
      user_id: user.id,
      priority: Number(form.priority) || 100,
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
          <div style={styles.modalTitle}>Category rules</div>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

        <div style={styles.ruleDescription}>
          Rules apply automatically to new transactions as they sync, and retroactively to
          existing history whenever you add, change, disable, or delete one — like an inbox
          filter with "apply to existing" always on.
        </div>

        {rules === null && <div style={styles.ruleEmpty}>Loading…</div>}

        {rules && rules.length > 0 && (
          <div style={styles.ruleListWrap}>
            {rules.map((r) => (
              <div key={r.id} style={styles.ruleRow}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => toggleRule(r)}
                  style={styles.ruleCheckbox}
                />
                <span style={styles.ruleRowText}>
                  <b>{r.priority}</b> — if <b>{r.match_field}</b> contains "<b>{r.match_value}</b>"
                  {r.set_category && <> → category <b>{r.set_category}</b></>}
                  {r.set_payee && <> → payee <b>{r.set_payee}</b></>}
                </span>
                <button
                  onClick={() => deleteRule(r)}
                  style={styles.ruleDeleteBtn}
                  className="rule-delete-btn"
                  title="Delete rule"
                  aria-label="Delete rule"
                >
                  <Trash2 size={15} />
                </button>
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
            <input
              style={styles.formInput}
              placeholder="(optional)"
              value={form.setCategory}
              onChange={(e) => setForm({ ...form, setCategory: e.target.value })}
            />
            and payee to
            <input
              style={styles.formInput}
              placeholder="(optional)"
              value={form.setPayee}
              onChange={(e) => setForm({ ...form, setPayee: e.target.value })}
            />
          </div>
          <div style={styles.ruleFormLine}>
            priority
            <input
              type="number"
              style={styles.formInputSmall}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            />
            <span style={{ fontSize: 11 }}>(lower runs first; later matches win ties)</span>
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
