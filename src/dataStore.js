// Module-level transaction data shared between the Ask page's QueryCard
// (which filters/groups it per query) and anything else that needs the
// same already-fetched rows (e.g. the palette's category ordering). Kept
// as live-binding module exports rather than React state so QueryCard
// doesn't need to be re-plumbed through props every time a new consumer
// shows up -- ES module named exports are live references, so reassigning
// these here is visible to every importer immediately.
import { computeDataMeta } from "./logic.js";

export let RAW_DATA = [];

export let CATS = [];

// Called once transactions have been fetched & cleaned. Populates the
// module-level data + derived lookups the rest of the app relies on for
// rendering (the system prompt is built server-side in api/query.js, from
// the same transactions fetched independently there via RLS).
export function loadData(rows) {
  RAW_DATA = rows;
  ({ CATS } = computeDataMeta(RAW_DATA));
}
