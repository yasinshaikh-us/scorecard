// The closed 22-category set, ported from src/categoryIcons.js (icons
// themselves aren't ported yet -- see mobile/README.md). Keys must match
// the allowed_categories list in apply_category_rules() (latest:
// supabase/migrations/20261027000000_add_insurance_home_services_personal_care_categories.sql)
// exactly, in the same order -- palette.ts assigns colors by index, so new
// categories go on the end.
export const CATEGORIES = [
  "Income", "Mortgage", "Investments", "Rent", "Alimony", "Taxes", "Miscellaneous",
  "Dining", "Shopping", "Utilities", "Groceries", "Transport", "Education", "Health",
  "Cash", "Travel", "Software", "Entertainment", "Fees",
  "Insurance", "Home Services", "Personal Care",
];
