#!/bin/sh

set -eu

readonly INTERFACE="${AWG_INTERFACE:-awg0}"

awg show "$INTERFACE" >/dev/null 2>&1
wget -q -T 5 -O /dev/null https://api.telegram.org/
