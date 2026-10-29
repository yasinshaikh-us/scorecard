// The closed 23-category set, ported from src/categoryIcons.js (icons
// themselves aren't ported yet -- see mobile/README.md). Keys must match
// the allowed_categories list in apply_category_rules() (latest:
// supabase/migrations/20261029000000_transfer_category_and_amount_rules.sql)
// exactly, in the same order -- palette.ts assigns colors by index, so new
// categories go on the end.
export const CATEGORIES = [
  "Income", "Mortgage", "Investments", "Rent", "Alimony", "Taxes", "Miscellaneous",
  "Dining", "Shopping", "Utilities", "Groceries", "Transport", "Education", "Health",
  "Cash", "Travel", "Software", "Entertainment", "Fees",
  "Insurance", "Home Services", "Personal Care",
  "Transfer",
];
