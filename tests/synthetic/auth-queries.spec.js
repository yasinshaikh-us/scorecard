// Layer 2 of the synthetic-monitoring framework: authenticated black-box
// checks — natural-language ledger queries against real data, plus the
// date-range/timezone regression tests targeting the week-bucketing bug in
// src/logic.js (groupKeyOf's local-midnight-through-toISOString round trip).
//
// Needs a way to act as a signed-in user against the real deployment
// (a dedicated monitoring Supabase/Google account's session, refreshed and
// injected the way tests/e2e/dashboard.spec.js fakes one — but with a real
// token here instead of a fabricated one) plus real ledger fixture data to
// assert against. Procedure for provisioning and refreshing that session,
// and for seeding/knowing fixture rows in the live table, is still being
// worked out — no tests here yet.
