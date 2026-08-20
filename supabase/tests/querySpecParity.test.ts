import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../functions/_shared/querySystemPrompt.ts";
import { SPEC_VOCABULARY } from "../../mobile/lib/specSchema.ts";

// The query vocabulary exists TWICE, on either side of a network hop:
//
//   * querySystemPrompt.ts  -- tells the model which values it may emit.
//   * mobile/lib/specSchema -- decides which values the app will accept.
//
// They are in different packages, with different test runners, and
// nothing connected them. Either half could grow a value the other has
// never heard of and every existing test would still pass:
//
//   * a value added to the prompt but not the whitelist is silently
//     rewritten to a default -- the model does as asked and the app
//     quietly answers a different question;
//   * a value added to the whitelist but not the prompt is dead code the
//     model will never emit, so the capability behind it is unreachable.
//
// This asserts the two agree, in the same spirit as
// categoryRulesParity.test.ts: run both halves, compare.

const prompt = buildSystemPrompt(["Groceries", "Dining"], ["Groceries:Super"], ["Checking"], "2020-03-02", "2026-08-19");

// Pulls the values a field's line in the response-shape block offers,
// e.g. `"metric": "sum" | "count" | ...` -> ["sum", "count", ...].
function documentedValues(field: string): string[] {
  const line = prompt.split("\n").find((l) => l.trim().startsWith(`"${field}":`));
  if (!line) throw new Error(`the prompt documents no "${field}" field at all`);
  const afterColon = line.slice(line.indexOf(":") + 1);
  return [...afterColon.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Values the app accepts but deliberately never asks the model for.
// "none" is the app's own way of saying "draw nothing" -- reachable
// through normalizeSpec's defaults, never through a model response, and
// the prompt says outright that every query gets a chart.
const APP_ONLY: Record<string, string[]> = {
  chartType: ["none"],
  groupBy: ["none"],
};

describe("query spec vocabulary parity", () => {
  for (const field of Object.keys(SPEC_VOCABULARY) as (keyof typeof SPEC_VOCABULARY)[]) {
    const accepted = SPEC_VOCABULARY[field] as readonly string[];

    it(`every ${field} value the prompt offers is one the app accepts`, () => {
      for (const value of documentedValues(field)) {
        expect(accepted, `the prompt offers ${field} "${value}", which normalizeSpec would discard`).toContain(value);
      }
    });

    it(`every ${field} value the app accepts is one the prompt offers`, () => {
      const documented = documentedValues(field);
      const unreachable = accepted.filter((v) => !documented.includes(v) && !(APP_ONLY[field] || []).includes(v));
      expect(unreachable, `the app accepts ${field} values the model is never told about`).toEqual([]);
    });
  }

  it("documents a field for every enum the app validates", () => {
    for (const field of Object.keys(SPEC_VOCABULARY)) {
      expect(() => documentedValues(field)).not.toThrow();
    }
  });

  // The non-enum fields have no value list to compare, so the parity that
  // matters for them is simply that both halves know they exist.
  it("documents every non-enum field the app reads off a spec", () => {
    for (const field of [
      "categories",
      "excludeCategories",
      "categoryContains",
      "payeeContains",
      "payeeAny",
      "accountContains",
      "dateStart",
      "dateEnd",
      "includeTransfers",
      "amountMin",
      "amountMax",
      "limit",
      "recurringOnly",
      "compareTo",
      "target",
      "forecast",
      "title",
    ]) {
      expect(prompt).toContain(`"${field}"`);
    }
  });
});
