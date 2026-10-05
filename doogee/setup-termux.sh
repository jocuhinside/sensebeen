#!/data/data/com.termux/files/usr/bin/bash
# One-shot Doogee provisioning. Run inside Termux (F-Droid build, not Play Store).
set -euo pipefail
pkg update -y
pkg install -y curl jq cronie termux-services termux-api openssh
cd "$(dirname "$0")"
[ -f postiz.env ] || { cp postiz.env.example postiz.env; chmod 600 postiz.env; echo "Edit postiz.env, then re-run."; exit 0; }
mkdir -p outbox sent
sv-enable crond 2>/dev/null || true
# Drain the outbox every 15 min. Keep the phone awake for cron.
( crontab -l 2>/dev/null | grep -v postiz-post.sh; echo "*/15 * * * * $PWD/postiz-post.sh outbox >> $PWD/postiz.log 2>&1" ) | crontab -
termux-wake-lock || true
echo "Done. Test: ./postiz-post.sh channels"
