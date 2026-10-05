#!/data/data/com.termux/files/usr/bin/bash
# Normalize media for Postiz: strip all metadata (EXIF/GPS/device), cap size, dedupe, stage into outbox/.
#   media-prep.sh <file|dir> ...        # dirs are scanned non-recursively
# Tunables via env: MAX_PX (default 1920), JPEG_Q (3 = high, 31 = low), VIDEO_CRF (28), MAX_VIDEO_MB (100)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p outbox sent .seen
MAX_PX=${MAX_PX:-1920}; JPEG_Q=${JPEG_Q:-3}; VIDEO_CRF=${VIDEO_CRF:-28}; MAX_VIDEO_MB=${MAX_VIDEO_MB:-100}

prep() {
  local src="$1" ext base hash out
  ext=$(tr '[:upper:]' '[:lower:]' <<<"${src##*.}")
  hash=$(sha256sum "$src" | cut -c1-16)
  [ -e ".seen/$hash" ] && { echo "skip (seen) $src"; return 0; }
  base="$(date -u +%Y%m%dT%H%M%SZ)-$hash"
  case "$ext" in
    jpg|jpeg|png|webp|heic)
      out="outbox/$base.jpg"
      ffmpeg -nostdin -loglevel error -y -i "$src" \
        -vf "scale='min($MAX_PX,iw)':'min($MAX_PX,ih)':force_original_aspect_ratio=decrease" \
        -map_metadata -1 -q:v "$JPEG_Q" "$out" ;;
    mp4|mov|mkv|webm)
      out="outbox/$base.mp4"
      ffmpeg -nostdin -loglevel error -y -i "$src" \
        -vf "scale='min($MAX_PX,iw)':-2" -c:v libx264 -crf "$VIDEO_CRF" -preset veryfast \
        -c:a aac -b:a 96k -map_metadata -1 -movflags +faststart "$out"
      if [ "$(stat -c %s "$out")" -gt $((MAX_VIDEO_MB*1024*1024)) ]; then
        echo "reject (>$MAX_VIDEO_MB MB after transcode) $src" >&2; rm -f "$out"; return 1
      fi ;;
    *) echo "unsupported: $src" >&2; return 1 ;;
  esac
  # Caption sidecar: <src>.txt or <name>.txt next to source, if present.
  for c in "$src.txt" "${src%.*}.txt"; do [ -f "$c" ] && { cp "$c" "${out%.*}.txt"; break; }; done
  : > ".seen/$hash"
  echo "staged $out"
}

[ $# -gt 0 ] || { echo "usage: $0 <file|dir>..." >&2; exit 2; }
for p in "$@"; do
  if [ -d "$p" ]; then
    for f in "$p"/*; do [ -f "$f" ] && { prep "$f" || true; }; done
  else
    prep "$p"
  fi
done
