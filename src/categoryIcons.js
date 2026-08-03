import {
  Wallet, Home, TrendingUp, Building2, Scale, Receipt, HelpCircle,
  UtensilsCrossed, ShoppingBag, Zap, ShoppingCart, Car, GraduationCap,
  HeartPulse, Banknote, Plane, AppWindow, Clapperboard, CircleDollarSign,
} from "lucide-react";

// One icon per category in the closed 19-category set (see
// supabase/migrations/20260803040000_closed_category_set.sql) -- keys
// must match those category names exactly. Anything not in this map
// (there shouldn't be anything, since categories are a closed set) falls
// back to HelpCircle.
export const CATEGORY_ICONS = {
  Income: Wallet,
  Mortgage: Home,
  Investments: TrendingUp,
  Rent: Building2,
  Alimony: Scale,
  Taxes: Receipt,
  Miscellaneous: HelpCircle,
  Dining: UtensilsCrossed,
  Shopping: ShoppingBag,
  Utilities: Zap,
  Groceries: ShoppingCart,
  Transport: Car,
  Education: GraduationCap,
  Health: HeartPulse,
  Cash: Banknote,
  Travel: Plane,
  Software: AppWindow,
  Entertainment: Clapperboard,
  Fees: CircleDollarSign,
};

export function iconForCategory(category) {
  return CATEGORY_ICONS[category] || HelpCircle;
}
