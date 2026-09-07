import { describe, it, expect } from "vitest";
import { cooldownRemaining, BALANCE_COOLDOWN_SECONDS } from "./balanceRefreshCooldown.ts";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

describe("cooldownRemaining", () => {
  it("refreshes when there is no stored balance yet", () => {
    expect(cooldownRemaining(null, NOW)).toBe(0);
    expect(cooldownRemaining(undefined, NOW)).toBe(0);
  });

  it("refreshes once the stored balance is older than the cooldown", () => {
    expect(cooldownRemaining(at(BALANCE_COOLDOWN_SECONDS + 1), NOW)).toBe(0);
    expect(cooldownRemaining(at(3600), NOW)).toBe(0);
  });

  it("holds off, and says for how long, while the stored balance is fresh", () => {
    expect(cooldownRemaining(at(0), NOW)).toBe(BALANCE_COOLDOWN_SECONDS);
    expect(cooldownRemaining(at(20), NOW)).toBe(BALANCE_COOLDOWN_SECONDS - 20);
  });

  // The boundary itself goes through: a balance exactly one cooldown old
  // has nothing left to wait for, and rounding it up to 1 would make the
  // client's next attempt fail for another whole second.
  it("goes through at exactly the cooldown boundary", () => {
    expect(cooldownRemaining(at(BALANCE_COOLDOWN_SECONDS), NOW)).toBe(0);
  });

  // Postgres stamps as_of; the Edge Function runtime reads the clock.
  // Nothing keeps those two in step, and a few seconds of skew the wrong
  // way would otherwise wedge refreshes for the length of the skew.
  it("refreshes rather than blocking when as_of is in the future", () => {
    expect(cooldownRemaining(at(-30), NOW)).toBe(0);
  });

  it("refreshes rather than blocking when as_of is unparseable", () => {
    expect(cooldownRemaining("not a timestamp", NOW)).toBe(0);
  });

  it("honours a caller-supplied window", () => {
    expect(cooldownRemaining(at(10), NOW, 300)).toBe(290);
    expect(cooldownRemaining(at(10), NOW, 5)).toBe(0);
  });
});
