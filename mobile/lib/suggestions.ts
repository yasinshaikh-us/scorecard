// The idle-state suggestions on Ask.
//
// These are the app's only advertisement of what it can be asked. The
// first set was eight variations on "how much did I spend on X", which
// described the app as it was in its first week and taught nobody that
// it could compare periods, find subscriptions, split one grouping by
// another, or project a month it hasn't finished.
//
// So the pool is deliberately broad: every metric (total, count,
// average, median, net), every grouping (day through year, category,
// merchant, account, individual transaction), and every one of the
// question shapes added since -- comparisons, budgets, recurrence,
// two-dimensional splits, projections, exclusions, multi-merchant. A
// handful name real merchants, because a question you can picture is a
// question you'll tap.
//
// Order here is by capability rather than by theme, so the grouping
// stays legible when one needs editing. What a reader sees is a random
// handful (see pickSuggestions), which is also why fifty is not too
// many: nobody is shown fifty.

export const SUGGESTIONS: string[] = [
  // --- totals and trends over time, at every granularity -------------
  "How much have I spent this month?",
  "What did I spend in the last 7 days?",
  "Show my spending week by week this quarter",
  "Spending by month over the last year",
  "Spending by quarter since 2020",
  "Which year did I spend the most?",
  "How much have I spent, all time?",

  // --- rankings ------------------------------------------------------
  "My 10 biggest purchases ever",
  "What's my single biggest expense this year?",
  "Top 5 merchants by spend this year",
  "Which category do I spend the most on?",
  "Which merchant do I visit most often?",
  "Show me every transaction over $5,000",

  // --- the shape of a category ---------------------------------------
  "Where does my money actually go? Break it down by category",
  "How much of my spending is dining out?",
  "What have I paid in rent, all time?",
  "What has my mortgage cost me since 2020?",
  "How much do I spend on groceries each month?",
  "Utilities by month — is the bill creeping up?",
  "What did I spend on travel in 2024?",

  // --- one merchant --------------------------------------------------
  "How much did I spend at Chipotle this year?",
  "Show my Amazon spending over the last two years",
  "How much have I spent at Starbucks since 2022?",
  "What's my Panda Express habit costing me?",

  // --- frequency, not money (count metric) ---------------------------
  "How often do I go to Panda Express?",
  "How many times did I take an Uber last year?",
  "How many transactions do I make in a month?",

  // --- the typical case (average and median) -------------------------
  "What's a typical grocery run cost me?",
  "What's my average Uber ride?",
  "What's the median amount I spend on dinner?",
  "What does a normal month of spending look like?",

  // --- several merchants at once -------------------------------------
  "Chipotle vs Panda Express vs Shake Shack",
  "How much do Netflix, YouTube and Amazon Prime cost me a year?",

  // --- money in, money out -------------------------------------------
  "Am I net positive this month?",
  "How much do I earn versus spend, month by month?",
  "What's my income by month this year?",
  "How much have I moved between my own accounts?",

  // --- comparisons ---------------------------------------------------
  "Did I spend more this month than last?",
  "Compare this quarter's spending to the one before it",
  "Am I eating out more than I did last month?",

  // --- budgets -------------------------------------------------------
  "Am I on track to keep dining under $600 this month?",
  "Am I keeping groceries under $800 this month?",

  // --- subscriptions and recurring bills ------------------------------
  "What am I subscribed to?",
  "What do my recurring bills cost me every month?",

  // --- two groupings at once ------------------------------------------
  "Show my spending by month, split by category",
  "Dining by month, split across my accounts",
  "Which account do I spend the most from?",

  // --- what's coming, and what to leave out ---------------------------
  "At this rate, what will I spend next month?",
  "Project my dining spend for the next three months",
  "My everyday spending by month, ignoring investments",
];

// A reader sees a handful, not the pool: fifty items drifting up the
// screen at once would be noise, and a fixed eight would make the app
// look as narrow as the old list did. A fresh sample each time the
// screen goes idle is also how someone discovers the range at all.
//
// `random` is injectable so a test can pin the sample; nothing else
// passes it.
export function pickSuggestions(pool: string[], count: number, random: () => number = Math.random): string[] {
  const shuffled = pool.slice();
  // Fisher-Yates, partial: only the first `count` positions have to end
  // up settled.
  const take = Math.min(count, shuffled.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, take);
}
