// The query a tap means.
//
// Tapping a payee or a category on any transaction row asks one fixed
// question -- "what has moved through here over the last twelve months?"
// -- and that question needs no model to interpret it. So this builds the
// spec directly and the Ask feed renders it on the same frame: the whole
// point of a tap over a typed question is that it is instant, and a round
// trip to the `query` Edge Function (network + a model call) is neither
// instant nor able to produce anything but this exact spec.
//
// Everything else about the resulting card is unchanged -- same
// QueryCard, same chart, same tap-to-filter, same row list -- so a
// drilldown is a shortcut into the app's existing answer surface rather
// than a second one.

import { monthsBefore } from "./format";
import { topCategory, type QuerySpec } from "./logic";

// Twelve CALENDAR months, ending with the one the ledger is currently
// in -- so the chart carries twelve monthly bars, not the thirteen
// partial ones a day-anchored "one year ago today" spans. The model is
// told to anchor a range-less question a year back to the day (see
// _shared/querySystemPrompt.ts), which is right for a total and wrong
// for an axis: it would leave the first and last bars covering part of
// a month each and reading as a dip that isn't there.
export const DRILLDOWN_MONTHS = 12;

export type DrilldownTarget = { kind: "payee" | "category"; value: string };

export type Drilldown = { question: string; spec: QuerySpec };

// `today` is the ledger's own latest date, not the device clock -- the
// same "now" QueryCard projects from and the same one the system prompt
// hands the model. A ledger that last synced in June answers a June
// question; anchoring to the device would quietly return a window with a
// stale tail and no explanation for it.
export function buildDrilldown(target: DrilldownTarget, today: string): Drilldown {
  const isPayee = target.kind === "payee";
  // A subcategory row ("Food:Restaurants") drills into its top-level
  // category, because that is what the badge draws, what the palette
  // colours, and what every category grouping in the app buckets by.
  const value = isPayee ? target.value : topCategory(target.value);

  const spec: QuerySpec = {
    // Both directions, deliberately: a payee is not always a merchant
    // (an employer, a refunding retailer, a broker) and the question a
    // tap asks is "what moved", not "what did I spend".
    type: "all",
    // Magnitudes, not the signed net this first shipped with.
    //
    // "net" reads better in principle -- an expense month below the axis,
    // an income month above it, a refund subtracting rather than adding.
    // On a real device it does not: one payee's months almost always
    // share a sign, and then the signed axis reserves the whole opposite
    // half for data that does not exist AND the bars grow downward
    // through the strip the month labels are drawn in. Stage 2 run 146's
    // screenshots have twelve Chipotle bars hanging under a $0-to-$100
    // void with "Dec", "Jun" and "Sep" unreadable on top of them; every
    // assertion in that spec passed, because every element was present.
    //
    // "sum" also agrees with the stat line above the chart, which totals
    // magnitudes whatever the metric -- under "net" the card's own
    // headline figure and its bars were measuring two different things.
    // Direction is not lost: it is on every row below, red for out and
    // green for in.
    metric: "sum",
    // Twelve monthly buckets is one screenful of bars and the smallest
    // grouping that still shows a year's shape. Bars rather than the
    // line a monthly grouping usually gets (chartTypeForGranularity):
    // most payees bill in some months and not others, and a line drawn
    // through those gaps implies a continuity the ledger doesn't have.
    groupBy: "month",
    chartType: "bar",
    // The FIRST of the month, DRILLDOWN_MONTHS - 1 months back: that
    // month plus every one after it up to today's is exactly twelve.
    dateStart: today ? `${monthsBefore(today, DRILLDOWN_MONTHS - 1).slice(0, 7)}-01` : null,
    // Left open, like the model's own default -- the ledger ends at
    // `today` by definition, so a bound there only risks excluding a row
    // dated the same day.
    dateEnd: null,
    // Show the window that was asked for, not the one the matching rows
    // happen to span: twelve bars whatever the payee's billing looks
    // like, and no re-grouping when they all land in one month. See
    // QuerySpec.fixedWindow.
    fixedWindow: true,
    payeeExact: isPayee ? value : null,
    categories: isPayee ? null : [value],
    title: isPayee ? `All activity at ${value}` : `All ${value} activity`,
  };

  return { question: `${value} — last 12 months`, spec };
}
