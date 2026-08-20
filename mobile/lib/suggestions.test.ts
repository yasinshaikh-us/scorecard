import { describe, it, expect } from "@jest/globals";
import { SUGGESTIONS, pickSuggestions } from "./suggestions";

// The suggestions are the app's only advertisement of what it can be
// asked, so these guard the two things that make them work: enough
// breadth to show the range, and a sample small enough to read.
describe("SUGGESTIONS", () => {
  it("offers fifty distinct questions", () => {
    expect(SUGGESTIONS).toHaveLength(50);
    expect(new Set(SUGGESTIONS).size).toBe(50);
  });

  it("keeps each one short enough to read as it drifts past", () => {
    for (const s of SUGGESTIONS) expect(s.length).toBeLessThanOrEqual(64);
  });

  // Not a style check: each phrase below is the trigger for a distinct
  // spec field or metric, and a pool that lost them would quietly stop
  // advertising that capability.
  it("covers every question shape the app can answer", () => {
    const pool = SUGGESTIONS.join(" | ").toLowerCase();
    const capabilities: Record<string, RegExp> = {
      "count metric": /how often|how many times|how many transactions/,
      "average": /average/,
      "median": /typical|median|normal month/,
      "net cashflow": /net positive|earn versus spend/,
      income: /income/,
      transfers: /between my own accounts/,
      comparison: /than last|compare this quarter|more than i did/,
      budget: /under \$\d/,
      recurring: /subscribed|recurring bills/,
      "multi-merchant": /vs |netflix, youtube and amazon prime/,
      "series split": /split by category|split across my accounts/,
      forecast: /at this rate|project my/,
      exclusion: /ignoring investments/,
      "amount threshold": /over \$5,000/,
      "transaction ranking": /biggest purchases|single biggest expense/,
      "merchant ranking": /top 5 merchants|merchant do i visit most/,
      "account grouping": /which account/,
      quarter: /quarter/,
      year: /which year|in 2024|since 2020/,
      week: /week by week/,
      day: /last 7 days/,
      "all time": /all time/,
      pie: /break it down by category/,
    };
    // Asserted as an object so a failure names the capability that lost
    // its suggestion, rather than just printing the whole pool. (Jest's
    // expect takes no message argument.)
    for (const [capability, pattern] of Object.entries(capabilities)) {
      expect({ capability, covered: pattern.test(pool) }).toEqual({ capability, covered: true });
    }
  });
});

describe("pickSuggestions", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("draws the asked-for number, without repeats", () => {
    const picked = pickSuggestions(pool, 3, () => 0.5);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const p of picked) expect(pool).toContain(p);
  });

  it("varies with the random source, so the screen isn't the same every visit", () => {
    const first = pickSuggestions(pool, 3, () => 0);
    const last = pickSuggestions(pool, 3, () => 0.999);
    expect(first).not.toEqual(last);
  });

  it("never asks for more than the pool holds", () => {
    expect(pickSuggestions(pool, 99, () => 0.5)).toHaveLength(5);
    expect(pickSuggestions([], 3, () => 0.5)).toEqual([]);
  });

  it("leaves the pool itself untouched", () => {
    const copy = [...pool];
    pickSuggestions(pool, 3, () => 0.7);
    expect(pool).toEqual(copy);
  });

  it("can produce every item in the pool across draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const s of pickSuggestions(pool, 2)) seen.add(s);
    expect(seen.size).toBe(pool.length);
  });
});
