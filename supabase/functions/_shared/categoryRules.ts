// Mirrors the SQL logic in apply_category_rules() (see
// supabase/migrations/20260803010000_add_category_rules_engine.sql) --
// same semantics, kept in sync deliberately rather than shared, since one
// runs in Postgres (bulk retroactive re-apply) and this one runs per
// transaction during the live sync. Case-insensitive "contains" match;
// rules apply in ascending priority order, later matches overwrite
// earlier ones for whichever field they set.

export interface CategoryRule {
  match_field: "payee" | "category";
  match_value: string;
  set_category: string | null;
  set_payee: string | null;
}

export function applyCategoryRules(rawPayee: string, rawCategory: string, rules: CategoryRule[]) {
  let category = rawCategory;
  let payee = rawPayee;

  for (const rule of rules) {
    const haystack = rule.match_field === "payee" ? rawPayee : rawCategory;
    if (!haystack.toLowerCase().includes(rule.match_value.toLowerCase())) continue;
    if (rule.set_category != null) category = rule.set_category;
    if (rule.set_payee != null) payee = rule.set_payee;
  }

  return { category, payee };
}
