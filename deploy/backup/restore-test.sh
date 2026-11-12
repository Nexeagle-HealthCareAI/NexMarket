#!/usr/bin/env bash
# Proves a backup can be restored: loads one .dump into a scratch database, counts its tables and rows, then
# drops the scratch database. It never touches a real database.
#
#   ./restore-test.sh /var/backups/nexmarket/2026-11-12_2030/nexmarket.dump
set -euo pipefail
file="${1:?Give the path of a .dump file}"
scratch="restore_test_$(date +%s)"

createdb "$scratch"
trap 'dropdb --if-exists "$scratch"' EXIT
# PostGIS must exist before the tables that use it.
psql -d "$scratch" -q -c 'create extension if not exists postgis' 2>/dev/null || true
pg_restore -d "$scratch" --no-owner --exit-on-error "$file"

tables="$(psql -d "$scratch" -At -c "select count(*) from information_schema.tables where table_schema = 'marketing'")"
rows="$(psql -d "$scratch" -At -c "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname = 'marketing'")"
psql -d "$scratch" -q -c 'analyze' && rows="$(psql -d "$scratch" -At -c "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname = 'marketing'")"
echo "Restored $file: $tables tables, about $rows rows in schema marketing."
[ "$tables" -gt 0 ] || { echo "No tables came back: this backup is not usable." >&2; exit 1; }
