#!/usr/bin/env bash
# Backs up every NexMarket database: the first one and each organisation's own (nm_*).
#
# Each run writes one compressed file per database into $BACKUP_DIR/<date>/, checks that each file can be read
# back, removes folders older than $KEEP_DAYS, and (when BACKUP_REMOTE is set) copies the day's folder off the
# server. It stops with an error code if any database fails, so cron or a monitor can raise an alert.
#
# Needs: pg_dump / pg_restore / psql of the same major version as the server.
# Connection: the usual PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD) or a ~/.pgpass file. Never put the
# password in this file or in the repository.
set -euo pipefail

MAIN_DB="${MAIN_DB:-nexmarket}"             # the first (platform) database
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexmarket}"
KEEP_DAYS="${KEEP_DAYS:-14}"                # days of backups kept on this server
BACKUP_REMOTE="${BACKUP_REMOTE:-}"          # e.g. s3://my-bucket/nexmarket  (uses the aws CLI) ; empty = stay local

stamp="$(date -u +%Y-%m-%d_%H%M)"
out="$BACKUP_DIR/$stamp"
mkdir -p "$out"
chmod 700 "$BACKUP_DIR" "$out"

# The first database, plus every organisation database that exists on the server.
mapfile -t dbs < <(psql -d postgres -At -c "select datname from pg_database where datname = '$MAIN_DB' or datname like 'nm\\_%' order by 1")
if [ "${#dbs[@]}" -eq 0 ]; then echo "No databases found (looked for $MAIN_DB and nm_*)." >&2; exit 2; fi

failed=0
for db in "${dbs[@]}"; do
  file="$out/$db.dump"
  if pg_dump -d "$db" --format=custom --compress=6 --no-owner --file="$file.part" \
     && pg_restore --list "$file.part" > /dev/null; then          # readable back = not a broken file
    mv "$file.part" "$file"
    echo "ok    $db  $(du -h "$file" | cut -f1)"
  else
    echo "FAILED $db" >&2
    failed=$((failed + 1))
  fi
done

( cd "$out" && sha256sum ./*.dump > SHA256SUMS 2>/dev/null || true )
echo "$stamp ${#dbs[@]} databases, $failed failed" >> "$BACKUP_DIR/backup.log"

if [ -n "$BACKUP_REMOTE" ] && [ "$failed" -eq 0 ]; then
  aws s3 cp --recursive --only-show-errors "$out" "$BACKUP_REMOTE/$stamp" || { echo "FAILED copy to $BACKUP_REMOTE" >&2; failed=$((failed + 1)); }
fi

# Old folders are removed only after a fully good run, so a failing backup never eats the last good ones.
if [ "$failed" -eq 0 ]; then
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +
fi

[ "$failed" -eq 0 ] || exit 1
