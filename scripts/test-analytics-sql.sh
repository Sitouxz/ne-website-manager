#!/usr/bin/env bash
# Runs the analytics SQL tests (supabase/tests/analytics_v2.test.sql) against a
# throwaway local Postgres: bootstrap stand-ins for Supabase, migrations
# 025–027, then assertions. Usage:
#   PGHOST=/tmp PGPORT=5433 PGUSER=postgres scripts/test-analytics-sql.sh
# Set SEED_EVENTS=500000 to also print RPC timings at that scale.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=analytics_sql_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
run -f supabase/tests/bootstrap.sql
run -f supabase/migrations/025_restore_analytics_events.sql
run -f supabase/migrations/026_analytics_is_bot.sql
run -f supabase/migrations/027_analytics_v2.sql
run -v seed_events="${SEED_EVENTS:-0}" -f supabase/tests/analytics_v2.test.sql
echo "analytics SQL tests passed"
