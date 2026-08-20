// The ledger Stage 2 asks its questions against.
//
// Lives here, next to the function that writes it, rather than in the
// Detox suite: the rows can only be inserted with the service role (the
// transactions table has SELECT and UPDATE policies for a signed-in user
// and nothing else -- inserting is not something a client is allowed to
// do, which is the right default and not worth weakening for a test
// fixture). test-seed-ledger is what runs this; the suite just asks it
// to.
//
// synthetic-monitor@scorecard.test had no transactions at all, so every
// Ask result on that stage rendered "No matching transactions" -- no
// chart, no stat block, no list. That bounded the specs to asserting
// that a card came back, and it quietly bounded the SCREENSHOTS too:
// every ask-screen-* image in every detox-results artifact was of an
// empty card, which is a poor thing to hand someone as visual proof that
// a chart renders.
//
// This generates a small ledger with the properties those assertions
// need, and nothing more:
//
//   * enough rows in the last twelve months (~300) to exceed the card's
//     200-row cap, so the cap is observable;
//   * a merchant asked about often enough to chart (Chipotle, weekly);
//   * a subscription on a real monthly cadence, so "what am I subscribed
//     to" has something true to find;
//   * income, so a net/cashflow question is not all one sign;
//   * one purchase big enough to trip the outlier callout.
//
// NOT lib/testLedger.ts, which serves the opposite purpose: that one is
// ~5,200 rows across six years, built so the Stage 1 tests meet the
// shapes that only appear at scale. This one is small on purpose -- it
// is written to a real shared database over the network before every
// Stage 2 run, and then deleted again.
//
// Dates are relative to the day the run happens, because the questions
// are ("this month", "the last twelve months"). Everything else is
// fixed: same payees, same amounts, same cadences, every run.

// Marks every row this file writes. `source` is only ever filtered as
// = 'plaid' by the sync and Plaid-link paths, so an 'e2e' row is
// invisible to all of them -- it cannot be mistaken for a synced
// transaction, and the Sandbox cleanup cannot touch it. It is also what
// makes the delete safe to express: one equality filter, on rows that by
// definition only this file creates.
export const E2E_SOURCE = "e2e";

const DAY = 86400000;

function isoDaysAgo(days: number, today: Date) {
  return new Date(today.getTime() - days * DAY).toISOString().slice(0, 10);
}

// Weekly-ish lunch, the merchant the specs ask about by name.
function chipotle(today: Date, rows: SeedRow[]) {
  for (let week = 0; week < 52; week++) {
    const amount = [-12.95, -13.95, -21.95, -10.97][week % 4];
    rows.push(row(isoDaysAgo(week * 7 + 2, today), "Chipotle", "Dining:Fast Food", amount));
  }
}

// Three or four other everyday merchants per week, so a category
// breakdown has more than one slice and the row count clears 200.
const EVERYDAY = [
  { payee: "Starbucks", category: "Dining:Coffee", amounts: [-4.75, -6.25, -3.9] },
  { payee: "Whole Foods", category: "Groceries:Supermarket", amounts: [-42.18, -88.4, -23.75] },
  { payee: "Uber", category: "Transport:Rideshare", amounts: [-14.3, -22.85, -9.6] },
  { payee: "Amazon", category: "Shopping:Online", amounts: [-28.99, -64.5, -17.25] },
  { payee: "Chevron", category: "Transport:Gas & Fuel", amounts: [-48.2, -61.05, -39.8] },
];

function everyday(today: Date, rows: SeedRow[]) {
  for (let week = 0; week < 52; week++) {
    for (const [i, merchant] of EVERYDAY.entries()) {
      // Staggered so a week is not five identical days.
      const day = week * 7 + ((i * 2) % 7);
      rows.push(row(isoDaysAgo(day, today), merchant.payee, merchant.category, merchant.amounts[week % 3]));
    }
  }
}

// A real monthly cadence for a stable amount: what recurrence detection
// is supposed to find, and what the everyday merchants above are
// supposed to be rejected as.
function subscriptions(today: Date, rows: SeedRow[]) {
  for (let month = 0; month < 12; month++) {
    rows.push(row(isoDaysAgo(month * 30 + 5, today), "Netflix", "Entertainment:Streaming", -15.99));
    rows.push(row(isoDaysAgo(month * 30 + 12, today), "T Mobile", "Utilities:Phone", -95));
  }
}

function income(today: Date, rows: SeedRow[]) {
  for (let month = 0; month < 12; month++) {
    rows.push(row(isoDaysAgo(month * 30 + 1, today), "Acme Payroll", "Income:Salary", 4200));
    rows.push(row(isoDaysAgo(month * 30 + 15, today), "Acme Payroll", "Income:Salary", 4200));
  }
}

export type SeedRow = {
  date: string;
  payee: string;
  category: string;
  amount: number;
  source: string;
  is_transfer: boolean;
};

function row(date: string, payee: string, category: string, amount: number): SeedRow {
  return { date, payee, category, amount, source: E2E_SOURCE, is_transfer: false };
}

// `today` is injectable so a test can pin it; the seeder passes the real
// clock, since the questions this feeds are relative ones.
export function buildE2eLedger(today: Date = new Date()): SeedRow[] {
  const rows: SeedRow[] = [];
  chipotle(today, rows);
  everyday(today, rows);
  subscriptions(today, rows);
  income(today, rows);
  // One purchase that dominates whatever period it lands in, so the
  // outlier callout has a case to state.
  rows.push(row(isoDaysAgo(45, today), "Sunset Motors", "Transport:Vehicle", -8400));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
