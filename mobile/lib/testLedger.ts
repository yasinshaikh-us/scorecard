// A synthetic ledger with the shape of a real one, for the tests that
// only mean something at scale.
//
// Every other fixture in this suite is two to four hand-written rows,
// which is right for asserting arithmetic and wrong for asserting
// behaviour that only appears in bulk: which granularity a six-year span
// resolves to, whether seventy-eight monthly buckets stay ordered and
// still fit a phone, what a nineteen-category pie does, whether
// recurrence detection finds the four subscriptions hiding among six
// thousand restaurant visits.
//
// Deterministic on purpose -- a seeded PRNG, no clock, no Math.random --
// so a failure is reproducible and a passing run means the same thing
// twice. The proportions mirror the real ledger this was built against:
// dining-dominated, a handful of monthly bills, twice-monthly income,
// and two six-figure investment purchases that dwarf everything else.

import type { Transaction } from "./types";

// mulberry32: small, fast, and identical across engines, which is what a
// fixture needs. Not for anything cryptographic.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;

// Visited often, at no particular rhythm -- the case recurrence
// detection has to NOT call a subscription.
const RESTAURANTS = [
  { payee: "Panda Express", category: "Dining:Fast Food", low: 8, high: 18 },
  { payee: "Chipotle", category: "Dining:Fast Food", low: 10, high: 35 },
  { payee: "Starbucks", category: "Dining:Coffee", low: 3, high: 9 },
  { payee: "Shake Shack", category: "Dining:Restaurants", low: 15, high: 60 },
  { payee: "Five Guys", category: "Dining:Restaurants", low: 18, high: 55 },
];

const GROCERS = [
  { payee: "Qfc Foods", category: "Groceries:Supermarket", low: 12, high: 90 },
  { payee: "Whole Foods", category: "Groceries:Supermarket", low: 20, high: 140 },
  { payee: "Safeway", category: "Groceries:Supermarket", low: 10, high: 75 },
];

const OTHER_SPEND = [
  { payee: "Amazon", category: "Shopping:Online", low: 8, high: 300 },
  { payee: "Uber", category: "Transport:Rideshare", low: 7, high: 45 },
  { payee: "Chevron", category: "Transport:Gas & Fuel", low: 30, high: 80 },
  { payee: "Bartell Drugs", category: "Health:Pharmacy", low: 5, high: 60 },
  { payee: "Amc", category: "Entertainment:Movies", low: 12, high: 40 },
  { payee: "Alaska Air", category: "Travel:Airfare", low: 120, high: 600 },
  { payee: "Udemy", category: "Education:Courses", low: 15, high: 200 },
];

// Billed on a cadence, for a stable amount: what "what am I subscribed
// to" must find.
const SUBSCRIPTIONS = [
  { payee: "Netflix", category: "Entertainment:Streaming", amount: 15.99, day: 10 },
  { payee: "Amazon Prime", category: "Shopping:Membership", amount: 14.99, day: 22 },
  { payee: "T Mobile", category: "Utilities:Phone", amount: 95, day: 20 },
  { payee: "Comcast", category: "Utilities:Internet", amount: 89.99, day: 16 },
];

const FIXED_BILLS = [
  { payee: "Chase Mortgage", category: "Mortgage:Payment", amount: 5220, day: 3 },
  { payee: "Amli", category: "Rent:Apartment", amount: 2995, day: 4 },
  { payee: "Gieco", category: "Transport:Car Insurance", amount: 87, day: 13 },
];

export const LEDGER_START = "2020-03-02";
export const LEDGER_END = "2026-08-19";

export type LedgerOptions = { seed?: number; start?: string; end?: string };

export function buildTestLedger({ seed = 20260819, start = LEDGER_START, end = LEDGER_END }: LedgerOptions = {}): Transaction[] {
  const random = seeded(seed);
  const rows: Transaction[] = [];
  let id = 1;

  // Date.UTC takes a 0-indexed month, so the -1 is not optional: without
  // it the ledger silently starts (and ends) a month late.
  const utc = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const startMs = utc(start);
  const endMs = utc(end);
  const push = (date: string, payee: string, category: string, amount: number, extra: Partial<Transaction> = {}) => {
    if (date < start || date > end) return;
    rows.push({
      Id: id++,
      Date: date,
      Payee: payee,
      Category: category,
      Amount: amount,
      Account: random() < 0.7 ? "Checking ••4471" : "Savings ••8802",
      IsTransfer: false,
      ...extra,
    });
  };

  const between = (low: number, high: number) => Math.round((low + random() * (high - low)) * 100) / 100;

  // Everyday spending, thickest on dining -- irregular by construction,
  // so nothing here should read as recurring.
  for (let ms = startMs; ms <= endMs; ms += DAY) {
    const date = iso(ms);
    const meals = random() < 0.9 ? 1 : random() < 0.4 ? 2 : 0;
    for (let i = 0; i < meals; i++) {
      const m = RESTAURANTS[Math.floor(random() * RESTAURANTS.length)];
      push(date, m.payee, m.category, -between(m.low, m.high));
    }
    if (random() < 0.32) {
      const g = GROCERS[Math.floor(random() * GROCERS.length)];
      push(date, g.payee, g.category, -between(g.low, g.high));
    }
    if (random() < 0.52) {
      const o = OTHER_SPEND[Math.floor(random() * OTHER_SPEND.length)];
      push(date, o.payee, o.category, -between(o.low, o.high));
    }
  }

  // Monthly rhythms: bills, subscriptions, salary, and the occasional
  // transfer between the account pair.
  for (let ms = startMs; ms <= endMs; ms += DAY) {
    const date = iso(ms);
    const dayOfMonth = Number(date.slice(8, 10));

    for (const s of SUBSCRIPTIONS) {
      // A day either side, the way a real bill drifts across weekends.
      if (dayOfMonth === s.day) push(date, s.payee, s.category, -s.amount);
    }
    for (const b of FIXED_BILLS) {
      if (dayOfMonth === b.day) push(date, b.payee, b.category, -b.amount);
    }
    if (dayOfMonth === 1 || dayOfMonth === 15) {
      push(date, "Acme Payroll", "Income:Salary", 6250);
    }
    if (dayOfMonth === 6) {
      push(date, "Transfer to Savings", "Miscellaneous:Transfer", -1500, { IsTransfer: true });
      push(date, "Transfer from Checking", "Miscellaneous:Transfer", 1500, { IsTransfer: true });
    }
  }

  // The two rows that distort every chart they appear in -- the reason
  // findOutlier and excludeCategories exist.
  push("2025-05-14", "Bitcoin", "Investments:Crypto", -100000);
  push("2025-07-22", "Bitcoin", "Investments:Crypto", -170000);
  push("2026-02-09", "Irs", "Taxes:Federal", -23440);

  return rows.sort((a, b) => a.Date.localeCompare(b.Date));
}
