#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_DIR="/opt/2popuga-bot"
readonly BRANCH="production"

cd "$APP_DIR"

git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [[ ! -f .env ]]; then
  install -m 0600 /dev/null .env
fi

docker compose up --detach --build --remove-orphans

container_id="$(docker compose ps --quiet bot)"

if [[ -z "$container_id" ]]; then
  echo "Bot container was not created" >&2
  exit 1
fi

for attempt in $(seq 1 30); do
  health_status="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$container_id"
  )"

  if [[ "$health_status" == "healthy" ]]; then
    docker compose ps
    exit 0
  fi

  if [[ "$health_status" == "unhealthy" ]]; then
    break
  fi

  sleep 2
done

echo "Bot container did not become healthy" >&2
docker compose ps
docker compose logs --tail 100 bot
exit 1
