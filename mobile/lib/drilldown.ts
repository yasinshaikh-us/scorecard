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

// Twelve, and anchored the same way the model is told to anchor a
// range-less question (see _shared/querySystemPrompt.ts: "Default the
// window to the last 12 months ... dateStart exactly one year before
// today, dateEnd null"). Tapping a payee and typing "how much at
// <payee>" therefore cover the same window rather than two windows that
// happen to look alike.
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
    // Signed, so an expense month reads below the axis and an income
    // month above it. A sum of magnitudes would draw a refund as more
    // spending.
    metric: "net",
    // Twelve monthly buckets is one screenful of bars and the smallest
    // grouping that still shows a year's shape. Bars rather than the
    // line a monthly grouping usually gets (chartTypeForGranularity):
    // most payees bill in some months and not others, and a line drawn
    // through those gaps implies a continuity the ledger doesn't have.
    groupBy: "month",
    chartType: "bar",
    dateStart: today ? monthsBefore(today, DRILLDOWN_MONTHS) : null,
    // Left open, like the model's own default -- the ledger ends at
    // `today` by definition, so a bound there only risks excluding a row
    // dated the same day.
    dateEnd: null,
    payeeExact: isPayee ? value : null,
    categories: isPayee ? null : [value],
    title: isPayee ? `All activity at ${value}` : `All ${value} activity`,
  };

  return { question: `${value} — last 12 months`, spec };
}
