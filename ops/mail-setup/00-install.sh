#!/usr/bin/env bash
# Installs Proton Mail Bridge + pass + gnupg (+ Thunderbird) on a Debian/Ubuntu host.
# Run on YOUR machine, not in the cloud container. Verify the .deb checksum against proton.me/mail/bridge before trusting it.
set -euo pipefail
BRIDGE_VER="${BRIDGE_VER:-3.21.2-1}"
DEB="protonmail-bridge_${BRIDGE_VER}_amd64.deb"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/$DEB" "https://proton.me/download/bridge/$DEB"
echo "sha256: $(sha256sum "$WORK/$DEB" | cut -d' ' -f1)"
echo "Compare against the value published at https://proton.me/mail/bridge, then press Enter (Ctrl-C to abort)."; read -r _
sudo apt-get update
sudo apt-get install -y gnupg pass thunderbird "$WORK/$DEB"
echo "Next: ./01-bootstrap-pass.sh, then 'protonmail-bridge --cli' -> login. See README.md."
