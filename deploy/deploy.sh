#!/bin/sh
# Deploys one version of Zinloop on this server. Run from the deploy folder's
# parent (e.g. /opt/zinloop), where docker-compose.yml and .env live:
#
#   sh deploy/deploy.sh CONSOLE_IMAGE BACKUP_IMAGE
#
# Steps: back up the database, pull the images, migrate and start, then wait
# for the console's health check. If it doesn't become healthy, the previous
# images are started again. Set SKIP_PULL=1 to use images already on the server.
set -eu

new_console="${1:?usage: deploy.sh CONSOLE_IMAGE BACKUP_IMAGE}"
new_backup="${2:?usage: deploy.sh CONSOLE_IMAGE BACKUP_IMAGE}"
cd "$(dirname "$0")/.."
log() { echo "$(date -u +%H:%M:%S) $*"; }

previous=""
[ -f .deployed ] && previous=$(cat .deployed)

# Records the running images in .env, so later commands on this server
# ("docker compose run console ...", "docker compose up -d backup") use them.
persist() {
  tmp=$(mktemp .env.XXXXXX) || return 1
  grep -v -E '^(CONSOLE_IMAGE|BACKUP_IMAGE)=' .env > "$tmp" || [ $? -eq 1 ] || { rm -f "$tmp"; return 1; }
  printf 'CONSOLE_IMAGE=%s\nBACKUP_IMAGE=%s\n' "$1" "$2" >> "$tmp" || { rm -f "$tmp"; return 1; }
  chmod 600 "$tmp" && mv "$tmp" .env
}

start() {
  CONSOLE_IMAGE="$1" BACKUP_IMAGE="$2" docker compose up -d --no-build --remove-orphans
}

wait_healthy() {
  id=$(docker compose ps -q console)
  [ -n "$id" ] || return 1
  i=0
  while [ "$i" -lt 36 ]; do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)
    [ "$status" = healthy ] && return 0
    i=$((i + 1))
    sleep 5
  done
  log "console health: $status"
  return 1
}

rollback() {
  log "deploy failed"
  docker compose logs --tail 50 migrate console || true
  if [ -n "$previous" ]; then
    log "starting the previous version again: $previous"
    # shellcheck disable=SC2086
    if start $previous && wait_healthy; then
      # shellcheck disable=SC2086
      persist $previous
      log "previous version is back"
    else
      log "ROLLBACK FAILED, check the server"
    fi
  fi
  exit 1
}

export CONSOLE_IMAGE="$new_console" BACKUP_IMAGE="$new_backup"
if [ "${SKIP_PULL:-}" != 1 ]; then
  log "pulling $new_console and $new_backup"
  docker compose pull --quiet migrate console maintenance backup agent-control
fi

log "starting the database"
docker compose up -d --wait db

if [ -n "$previous" ]; then
  # A fresh backup before migrations run, so a bad migration can be undone.
  log "backing up before the upgrade"
  docker compose run --rm --no-deps backup backup.sh once || { log "backup failed, not deploying"; exit 1; }
fi

log "migrating and starting $new_console"
start "$new_console" "$new_backup" || rollback
wait_healthy || rollback

echo "$new_console $new_backup" > .deployed
persist "$new_console" "$new_backup"
log "deployed $new_console"
docker image prune -f >/dev/null 2>&1 || true
