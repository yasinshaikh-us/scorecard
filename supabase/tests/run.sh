#!/usr/bin/env bash
# Applies the real migrations to a throwaway Postgres and runs the SQL
# tests in supabase/tests/sql/ against the result.
#
# Usage:
#   DATABASE_URL=postgres://postgres:postgres@localhost:55432/scorecard_test \
#     supabase/tests/run.sh
#
# Every statement runs with ON_ERROR_STOP=1, so a failed assertion (see
# test.assert* in bootstrap.sql) or a migration that no longer applies
# aborts immediately with a nonzero exit.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
migrations_dir="$repo_root/supabase/migrations"

psql_run() { psql "$DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"; }

# Migrations are not idempotent (they ALTER TABLE ... ADD COLUMN, DROP
# INDEX by name, and so on), so this always starts from an empty database
# rather than layering onto whatever was there. That keeps a local re-run
# and a fresh CI container behaving identically.
echo "==> Resetting schemas"
psql_run -c '
  drop schema if exists public cascade;
  drop schema if exists auth cascade;
  drop schema if exists test cascade;
  drop schema if exists cron cascade;
  drop schema if exists net cascade;
  drop schema if exists vault cascade;
  create schema public;
' >/dev/null

echo "==> Bootstrapping Supabase platform primitives"
psql_run -f "$here/bootstrap.sql" >/dev/null

echo "==> Applying migrations"
for migration in "$migrations_dir"/*.sql; do
  name="$(basename "$migration")"
  # `create extension pg_cron/pg_net` cannot succeed on stock Postgres --
  # the extension binaries aren't installed. bootstrap.sql already provides
  # the cron/net/vault functions those migrations go on to call, so the
  # rest of each migration applies normally with just these lines removed.
  # Anything else failing is a real failure and stops the run.
  sed -E '/create extension if not exists (pg_cron|pg_net)\s*;/d' "$migration" \
    | psql_run >/dev/null
  echo "    ok  $name"
done

echo "==> Running SQL tests"
failed=0
for test_file in "$here"/sql/*.sql; do
  name="$(basename "$test_file")"
  # Each test file runs in its own transaction and is ALWAYS rolled back:
  # tests insert real rows, and one file's fixtures must never leak into
  # the next. `--single-transaction` plus a trailing rollback in the file
  # would double up, so the rollback is forced here instead.
  if (echo "begin;"; cat "$test_file"; echo "rollback;") | psql_run >/dev/null; then
    echo "    PASS  $name"
  else
    echo "    FAIL  $name"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "==> SQL tests FAILED"
  exit 1
fi

echo "==> All SQL tests passed"
