#!/data/data/com.termux/files/usr/bin/bash
# Doogee capture -> sanitized media in outbox/. Needs the Termux:API app + termux-api pkg.
#   capture.sh photo [caption] [cam_id=0]
#   capture.sh snapshot [caption]   # photo + battery/time line appended to caption (never GPS)
#   capture.sh ingest [dir]         # sanitize + stage new clips/photos from the camera app folder
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
stage() { # file caption
  [ -n "${2:-}" ] && printf '%s' "$2" > "$1.txt"
  ./media-prep.sh "$1"
}
sensor_line() {
  local bat; bat=$(termux-battery-status 2>/dev/null | jq -r '"\(.percentage)% \(.temperature)C"' 2>/dev/null || echo "n/a")
  echo "bat ${bat} | $(date -u +%FT%TZ)"
}
case "${1:-}" in
  photo)
    termux-camera-photo -c "${3:-0}" "$TMP/p.jpg"; stage "$TMP/p.jpg" "${2:-}" ;;
  snapshot)
    termux-camera-photo -c 0 "$TMP/p.jpg"
    stage "$TMP/p.jpg" "${2:+$2
}$(sensor_line)" ;;
  ingest)
    ./media-prep.sh "${2:-$HOME/storage/dcim/Camera}" ;;
  *) echo "usage: $0 photo|snapshot|ingest" >&2; exit 2 ;;
esac
