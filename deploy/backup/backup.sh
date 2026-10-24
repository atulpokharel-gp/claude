#!/bin/sh
# Backs up the Zinloop database once a day (or once, with "backup.sh once").
#
#   DATABASE_ADMIN_URL    owner connection (required)
#   BACKUP_DIR            where dumps go (default /backups); keep it on its own volume
#   BACKUP_KEEP_DAYS      local dumps older than this are deleted (default 14)
#   BACKUP_S3_URI         optional off-site copy, e.g. s3://my-bucket/zinloop
#   BACKUP_S3_ENDPOINT    for S3-compatible storage (Backblaze B2, Cloudflare R2, Wasabi...)
#   BACKUP_AGE_RECIPIENT  age public key; required with BACKUP_S3_URI so off-site copies are encrypted
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION  storage credentials
#
# Each run is recorded in job_runs, so /api/health?jobs=1 notices when backups stop.
set -u

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

run_once() {
  [ -n "${DATABASE_ADMIN_URL:-}" ] || { log "DATABASE_ADMIN_URL is not set"; return 1; }
  if [ -n "${BACKUP_S3_URI:-}" ] && [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
    log "BACKUP_S3_URI is set but BACKUP_AGE_RECIPIENT isn't. Off-site backups must be encrypted."
    return 1
  fi
  mkdir -p "$DIR" || return 1
  ts=$(date -u +%Y-%m-%dT%H%M%SZ)
  f="$DIR/zinloop-$ts.dump"
  # Custom format: compressed, and pg_restore can check it and restore selectively.
  pg_dump --format=custom --no-owner --file="$f.part" "$DATABASE_ADMIN_URL" || { rm -f "$f.part"; log "pg_dump failed"; return 1; }
  pg_restore --list "$f.part" >/dev/null || { rm -f "$f.part"; log "the dump isn't readable"; return 1; }
  mv "$f.part" "$f" || return 1
  log "saved $f ($(du -h "$f" | cut -f1))"
  find "$DIR" -name 'zinloop-*.dump' -mtime +"$KEEP_DAYS" -exec rm -f {} + || return 1
  if [ -n "${BACKUP_S3_URI:-}" ]; then
    dest="${BACKUP_S3_URI%/}/zinloop-$ts.dump.age"
    age -r "$BACKUP_AGE_RECIPIENT" -o "$f.age" "$f" || { rm -f "$f.age"; log "encryption failed"; return 1; }
    if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
      aws s3 cp --only-show-errors --endpoint-url "$BACKUP_S3_ENDPOINT" "$f.age" "$dest"
    else
      aws s3 cp --only-show-errors "$f.age" "$dest"
    fi
    up=$?
    rm -f "$f.age"
    [ "$up" -eq 0 ] || { log "upload to $dest failed"; return 1; }
    log "uploaded an encrypted copy to $dest"
  fi
}

record() {
  if [ "$1" = ok ]; then
    sql="insert into job_runs (job, last_ok_at) values ('backup', now()) on conflict (job) do update set last_ok_at = now()"
  else
    sql="insert into job_runs (job, last_err_at, last_error) values ('backup', now(), 'see the backup container log') on conflict (job) do update set last_err_at = now(), last_error = excluded.last_error"
  fi
  psql "$DATABASE_ADMIN_URL" -q -c "$sql" >/dev/null 2>&1 || log "couldn't record the backup result"
}

once() {
  if run_once; then record ok; return 0; else record failed; return 1; fi
}

if [ "${1:-}" = once ]; then
  once
  exit $?
fi
while true; do
  once
  sleep 86400
done
