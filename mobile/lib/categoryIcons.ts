import {
  Wallet,
  Home,
  TrendingUp,
  Building2,
  Scale,
  Receipt,
  HelpCircle,
  UtensilsCrossed,
  ShoppingBag,
  Zap,
  ShoppingCart,
  Car,
  GraduationCap,
  HeartPulse,
  Banknote,
  Plane,
  AppWindow,
  Clapperboard,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react-native";

// Mirrors ../../src/categoryIcons.js -- one icon per category in the
// closed 19-category set (see lib/categories.ts and
// supabase/migrations/20260803040000_closed_category_set.sql). Keys must
// match those category names exactly; anything unmapped falls back to
// HelpCircle, same as the web version.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
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

export function iconForCategory(category: string): LucideIcon {
  return CATEGORY_ICONS[category] || HelpCircle;
}
