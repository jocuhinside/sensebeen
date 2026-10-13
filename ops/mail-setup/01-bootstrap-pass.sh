#!/usr/bin/env bash
# Creates a GPG key (if none) and initialises `pass` so Proton Bridge has a credential store.
set -euo pipefail
command -v gpg >/dev/null || { echo "install gnupg + pass first"; exit 1; }
command -v pass >/dev/null || { echo "install pass first"; exit 1; }

KEYID="$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^sec/{print $5; exit}')"
if [ -z "${KEYID}" ]; then
  echo "No GPG secret key found; generating one (set a passphrase you will keep)."
  gpg --quick-generate-key "Bridge Store <bridge@localhost>" ed25519 cert 0
  KEYID="$(gpg --list-secret-keys --with-colons | awk -F: '/^sec/{print $5; exit}')"
  gpg --quick-add-key "$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')" cv25519 encr 0
fi
[ -d "${HOME}/.password-store" ] || pass init "${KEYID}"
echo "pass initialised with key ${KEYID}"
