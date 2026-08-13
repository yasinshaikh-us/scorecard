import { defineConfig } from "vitest/config";

// The repo root holds no application code -- the app itself is the Expo
// app in mobile/, which has its own Jest-based runner (mobile/package.json's
// "test" script). This config exists for one thing: the portable, Node-
// runnable logic inside the Supabase Edge Functions
// (supabase/functions/_shared/*.test.ts), which is backend code the mobile
// app calls and which nothing in mobile/ covers.
//
// (Previously this was vite.config.js, doing double duty as the web app's
// build config -- there's no web app any more, so only the test half of it
// survives, without the vite/React plugin machinery.)
export default defineConfig({
  // Deno resolves bare-npm dependencies via `npm:` specifiers, which Node
  // has no notion of. Mapping them onto the ordinary npm packages of the
  // same name is what lets a file that imports one still be unit-tested
  // here -- verifyPlaidWebhook.ts is the case that matters, since it's the
  // signature check standing between a forged webhook and real writes, and
  // its `npm:jose@6` import was the only thing making it untestable.
  //
  // Keep the pinned major in the alias in sync with the source specifier:
  // if a function moves to npm:jose@7, this must move with it, or the test
  // would silently keep exercising the old major.
  resolve: {
    alias: [{ find: /^npm:jose@6$/, replacement: "jose" }],
  },
  test: {
    // Node environment, not jsdom: nothing here renders a UI, and the Edge
    // Function tests need the real Node fetch/crypto rather than jsdom's
    // polyfills.
    environment: "node",
    // mobile/ has its own separate Jest-based test runner and its own
    // tsconfig (extends "expo/tsconfig.base", which only exists inside
    // mobile/node_modules) -- letting Vitest's default glob pick up
    // mobile/**/*.test.ts(x) breaks the tsconfig resolution here.
    exclude: ["**/node_modules/**", "**/mobile/**"],
    coverage: {
      provider: "v8",
      // `all: true` is the whole point of this block. Without it, v8 only
      // instruments files the suite actually imports -- so an untested
      // file contributes nothing at all rather than 0%, and the headline
      // percentage describes only the code that already has tests. This
      // repo's numbers read 98/82/100/100 that way while most of
      // supabase/functions/ had no tests, which is worse than no gate: it
      // looked like a passing signal.
      all: true,
      include: ["supabase/functions/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // Deliberately no `all: true` / broad `include` -- this only
      // instruments the files the suite actually imports (the portable
      // supabase/functions/_shared/*.ts helpers). The Deno-only glue
      // (Deno.serve/Deno.env, `npm:` imports) can't be imported under Node
      // at all, so forcing it into the instrumented set would just fail the
      // run instead of reporting real 0%s.
      reporter: ["text", "text-summary"],
      // These look low because they are now honest. With `all: true` the
      // denominator is the whole of supabase/functions/ (688 statements),
      // not just the files that happen to have tests (58 before). The
      // numbers are the real measured baseline, set a hair under it, so
      // the gate does the one job it can usefully do: fail if coverage
      // goes BACKWARDS. It is not a target to admire.
      //
      // What's structurally out of reach, and why the ceiling isn't 100:
      //   * Every function's index.ts (~1,156 lines) is Deno-only --
      //     Deno.serve/Deno.env and `npm:` specifiers that don't resolve
      //     under Node. Covering these needs a Deno test runner or real
      //     deployed-function integration tests, not Vitest.
      //   * plaid.ts / plaidSandbox.ts / supabaseAdmin.ts are thin
      //     Deno.env-reading client factories, same problem.
      //   * requireUser.ts reads Deno.env directly.
      //
      // syncItemTransactions.ts used to be listed here as untestable for
      // the same reason. It no longer is: its Plaid and Supabase clients
      // are now injected parameters rather than value imports, which took
      // the whole Plaid ingest path from 0% to ~98% and roughly doubled
      // the project-wide numbers below. The same treatment is what would
      // unlock each function's index.ts, if their Deno.serve entry points
      // were ever split from their handler bodies.
      thresholds: {
        statements: 32,
        branches: 25,
        functions: 45,
        lines: 32,
      },
    },
  },
});
