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
# Amnezia exports unused Legacy I1-I5 parameters as empty assignments, while
# the Linux awg parser expects those optional lines to be absent. Table=off
# prevents awg-quick from changing container sysctls and firewall rules.
sed \
  -e '/^[[:space:]]*DNS[[:space:]]*=/d' \
  -e '/^[[:space:]]*I[1-5][[:space:]]*=[[:space:]]*$/d' \
  -e '/^[[:space:]]*Table[[:space:]]*=/d' \
  -e '/^[[:space:]]*\[Interface\][[:space:]]*$/a Table = off' \
  "$SOURCE_CONFIG" > "$RUNTIME_CONFIG"

endpoint="$(sed -n 's/^[[:space:]]*Endpoint[[:space:]]*=[[:space:]]*//p' "$RUNTIME_CONFIG")"
endpoint_host="${endpoint%:*}"
default_gateway="$(
  ip -4 route show default |
    awk 'NR == 1 { for (field = 1; field <= NF; field += 1) if ($field == "via") print $(field + 1) }'
)"
default_device="$(
  ip -4 route show default |
    awk 'NR == 1 { for (field = 1; field <= NF; field += 1) if ($field == "dev") print $(field + 1) }'
)"

case "$endpoint_host" in
  "" | *[!0-9.]*)
    echo "AmneziaWG endpoint must use an IPv4 address" >&2
    exit 1
    ;;
esac

if [ -z "$default_gateway" ] || [ -z "$default_device" ]; then
  echo "Failed to resolve the container's default IPv4 route" >&2
  exit 1
fi

cleanup() {
  awg-quick down "$RUNTIME_CONFIG" >/dev/null 2>&1 || true
}

trap 'exit 0' INT TERM
trap cleanup EXIT

ip -4 route replace "${endpoint_host}/32" via "$default_gateway" dev "$default_device"
awg-quick up "$RUNTIME_CONFIG"
ip -4 route replace default dev "$INTERFACE"

while :; do
  sleep 3600 &
  wait "$!"
done
