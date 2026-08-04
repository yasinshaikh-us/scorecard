import { useState } from "react";
import { Pencil } from "lucide-react";
import { styles } from "./styles.js";
import { iconForCategory, CATEGORIES } from "./categoryIcons.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { fmtDate, fmtMoney, topCategory } from "./logic.js";

// Shared by HomePage's Recent Activity and QueryCard's result list -- one
// place for the "edit this row directly" feature (payee + category only;
// amount/date come from the bank and aren't user-editable) so both lists
// stay in sync rather than each growing its own copy of this logic.
//
// `row` is the actual object living inside dataStore's RAW_DATA (and, by
// extension, App.jsx's `transactions` state -- they're the same array
// right after a fetch, see App.jsx's refreshTransactions). On a successful
// save this mutates row.Payee/row.Category in place for instant feedback
// in this row, then calls `onEdited` (App.jsx's refreshTransactions,
// threaded down through HomePage/AskPage/QueryCard) so the rest of the
// tree -- e.g. QueryCard's RowDetailPopover, a sibling component that
// doesn't re-render just because this row's own local state changed --
// picks up the edit too, the same way rule changes already trigger a
// refetch rather than relying on in-place mutation alone.
export default function TransactionRow({ row, categoryBadgeStyle, onEdited, onMouseEnter, onMouseMove, onMouseLeave }) {
  const [editing, setEditing] = useState(false);
  const [draftPayee, setDraftPayee] = useState(row.Payee);
  const [draftCategory, setDraftCategory] = useState(row.Category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEdit() {
    setDraftPayee(row.Payee);
    setDraftCategory(row.Category);
    setError(null);
    setEditing(true);
    // The row's content is about to be replaced by the edit form without
    // a real mouse-leave event -- drop any hover-triggered popover
    // referencing it so it doesn't sit there showing pre-edit data.
    onMouseLeave?.();
  }

  async function save() {
    const trimmed = draftPayee.trim();
    if (!trimmed) {
      setError("Payee can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    // manually_edited=true so apply_category_rules() and the Plaid sync
    // path both leave this row alone from now on -- otherwise the very
    // next rule change (or a later Plaid "modified" update for the same
    // transaction) would silently overwrite this edit.
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
      <div style={styles.txRow}>
        <div style={styles.txEditRow}>
          <input
            style={{ ...styles.formInput, flex: 1 }}
            value={draftPayee}
            onChange={(e) => setDraftPayee(e.target.value)}
            disabled={saving}
            autoFocus
          />
          <select
            style={styles.formSelect}
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value)}
            disabled={saving}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={styles.txEditActions}>
          <button style={styles.addBankConfirmCancel} onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </button>
          <button style={styles.askBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {error && <div style={styles.ruleError}>{error}</div>}
      </div>
    );
  }

  const Icon = iconForCategory(topCategory(row.Category));
  const badge = categoryBadgeStyle || { background: "var(--surface-recessed)", color: "var(--text-muted)" };

  return (
    <div
      className="tx-row"
      style={styles.txRow}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div style={styles.txRowTop}>
        <div style={styles.txPayee}>{row.Payee}</div>
        <div style={styles.txRight}>
          <span
            title={row.Category}
            aria-label={row.Category}
            style={{ ...styles.categoryIconBadge, ...badge }}
          >
            <Icon size={14} />
          </span>
          <span style={{ ...styles.txAmount, color: row.Amount < 0 ? "var(--danger)" : "var(--accent)" }}>
            {fmtMoney(row.Amount)}
          </span>
          {row.Id != null && (
            <button
              onClick={startEdit}
              style={styles.txEditBtn}
              className="tx-edit-btn"
              title="Edit transaction"
              aria-label="Edit transaction"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>
      <div style={styles.txDate}>{fmtDate(row.Date)}</div>
    </div>
  );
}
