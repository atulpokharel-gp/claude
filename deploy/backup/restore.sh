#!/bin/sh
# Restores a Zinloop backup.
#
#   restore.sh --check FILE   restore into a scratch database, print row counts, drop it (safe)
#   restore.sh --yes FILE     replace the live database's contents with FILE (destructive)
#
# FILE is a .dump from BACKUP_DIR, or a .dump.age off-site copy (needs
# AGE_IDENTITY_FILE pointing at the age private key). Uses DATABASE_ADMIN_URL.
set -eu

mode="${1:-}"
file="${2:-}"
if { [ "$mode" != --check ] && [ "$mode" != --yes ]; } || [ -z "$file" ]; then
  echo "usage: restore.sh --check FILE | restore.sh --yes FILE" >&2
  exit 2
fi
: "${DATABASE_ADMIN_URL:?set DATABASE_ADMIN_URL}"

src="$file"
tmp=""
case "$file" in
  *.age)
    : "${AGE_IDENTITY_FILE:?set AGE_IDENTITY_FILE to the age private key file to decrypt $file}"
    tmp=$(mktemp)
    age -d -i "$AGE_IDENTITY_FILE" -o "$tmp" "$file"
    src="$tmp"
    ;;
esac
cleanup() { [ -n "$tmp" ] && rm -f "$tmp"; return 0; }
trap cleanup EXIT

if [ "$mode" = --check ]; then
  scratch="zinloop_restore_check_$$"
  psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database $scratch"
  # Same server, other database: swap the database name in the URL's path.
  url=$(printf '%s' "$DATABASE_ADMIN_URL" | sed -E "s#^(postgres(ql)?://[^/]+/)[^?]*#\1$scratch#")
  status=0
  pg_restore --no-owner --exit-on-error -d "$url" "$src" || status=$?
  if [ "$status" -eq 0 ]; then
    psql "$url" -At -c "select 'msps', count(*) from msps union all select 'users', count(*) from users union all select 'clients', count(*) from clients union all select 'scans', count(*) from scans" | tr '|' ' '
  fi
  psql "$DATABASE_ADMIN_URL" -q -c "drop database $scratch" || true
  [ "$status" -eq 0 ] && echo "restore check passed" || echo "restore check FAILED" >&2
  exit "$status"
fi

echo "Replacing the contents of the live database with $file."
pg_restore --no-owner --clean --if-exists --exit-on-error -d "$DATABASE_ADMIN_URL" "$src"
echo "Restored. Restart the console: docker compose restart console maintenance"
