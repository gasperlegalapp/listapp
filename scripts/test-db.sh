#!/usr/bin/env bash
# Apply every migration to a throwaway database and run the RLS test suite.
#
#   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
#
# The URL must be a superuser connection to a server you do not care about;
# this script creates and drops a database named listapp_test.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

ADMIN_URL="${TEST_DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"
DB=listapp_test
TEST_URL="${ADMIN_URL%/*}/$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists $DB" -c "create database $DB"
trap '"${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

"${PSQL[@]}" "$TEST_URL" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -f "$f"
done
for f in supabase/tests/[1-9]*.sql; do
  echo "test     $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -o /dev/null -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ NOTICE:  //' 
done
echo "All database tests passed."
