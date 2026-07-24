#!/bin/sh

set -eu

readonly SOURCE_CONFIG="/run/secrets/amneziawg.conf"
readonly INTERFACE="${AWG_INTERFACE:-awg0}"
readonly RUNTIME_DIRECTORY="/run/amneziawg"
readonly RUNTIME_CONFIG="${RUNTIME_DIRECTORY}/${INTERFACE}.conf"

if [ ! -r "$SOURCE_CONFIG" ]; then
  echo "AmneziaWG configuration is missing or unreadable" >&2
  exit 1
fi

umask 077
mkdir -p "$RUNTIME_DIRECTORY"

# Docker's embedded DNS remains reachable outside the tunnel. Removing this
# directive prevents awg-quick from trying to rewrite Docker-managed resolv.conf.
sed '/^[[:space:]]*DNS[[:space:]]*=/d' "$SOURCE_CONFIG" > "$RUNTIME_CONFIG"

cleanup() {
  awg-quick down "$RUNTIME_CONFIG" >/dev/null 2>&1 || true
}

trap 'exit 0' INT TERM
trap cleanup EXIT

awg-quick up "$RUNTIME_CONFIG"

while :; do
  sleep 3600 &
  wait "$!"
done
