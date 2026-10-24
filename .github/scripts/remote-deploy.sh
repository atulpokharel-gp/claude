#!/usr/bin/env bash
# Called by the deploy workflow: copies the compose files to the server over
# SSH, runs deploy/deploy.sh there, then checks the public health URL.
# Settings come from the GitHub environment's secrets (see docs/deploy.md).
set -euo pipefail

: "${CONSOLE_IMAGE:?}" "${BACKUP_IMAGE:?}" "${REGISTRY_TOKEN:?}" "${REGISTRY_USER:?}"
if [ -z "${SSH_HOST:-}" ]; then
  echo "::notice::No server is set up for the ${ENVIRONMENT_NAME:-this} environment (SSH_HOST secret is empty), so nothing was deployed."
  exit 0
fi
: "${SSH_USER:?set the SSH_USER secret}" "${SSH_KEY:?set the SSH_KEY secret}" "${SSH_KNOWN_HOSTS:?set the SSH_KNOWN_HOSTS secret (ssh-keyscan output for the server)}"
DIR="${DEPLOY_DIR:-/opt/zinloop}"

umask 077
mkdir -p ~/.ssh
printf '%s\n' "$SSH_KEY" > ~/.ssh/deploy_key
printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
SSH=(ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes -o BatchMode=yes "$SSH_USER@$SSH_HOST")

echo "Copying compose files to $SSH_HOST:$DIR"
tar -czf - docker-compose.yml deploy | "${SSH[@]}" "mkdir -p '$DIR' && tar -xzf - -C '$DIR'"

echo "Deploying $CONSOLE_IMAGE"
# The registry token goes over stdin, never on a command line.
printf '%s' "$REGISTRY_TOKEN" | "${SSH[@]}" "docker login ghcr.io -u '$REGISTRY_USER' --password-stdin >/dev/null"
set +e
"${SSH[@]}" "cd '$DIR' && sh deploy/deploy.sh '$CONSOLE_IMAGE' '$BACKUP_IMAGE'"
status=$?
set -e
"${SSH[@]}" "docker logout ghcr.io >/dev/null" || true
[ "$status" -eq 0 ] || { echo "::error::Deploy failed on the server (it rolled back if it could)."; exit "$status"; }

if [ -n "${CONSOLE_URL:-}" ]; then
  echo "Checking ${CONSOLE_URL%/}/api/health"
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 10 "${CONSOLE_URL%/}/api/health" >/dev/null; then
      echo "Healthy."
      exit 0
    fi
    sleep 6
  done
  echo "::error::The server says the console is healthy, but ${CONSOLE_URL%/}/api/health isn't reachable. Check DNS, Caddy and the firewall."
  exit 1
fi
