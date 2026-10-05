#!/data/data/com.termux/files/usr/bin/bash
# Doogee capture node -> Postiz public API.
#   postiz-post.sh channels
#   postiz-post.sh post "caption" [file ...]
#   postiz-post.sh outbox          # drain ./outbox: each <name>.jpg|mp4|png + optional <name>.txt caption
set -euo pipefail
cd "$(dirname "$0")"
[ -f postiz.env ] || { echo "missing postiz.env" >&2; exit 1; }
set -a; . ./postiz.env; set +a
API="${POSTIZ_URL%/}/api/public/v1"
AUTH=(-H "Authorization: $POSTIZ_API_KEY")
CURL=(curl -fsS --retry 3 --retry-delay 5 --max-time 120)

channels() { "${CURL[@]}" "${AUTH[@]}" "$API/integrations" | jq -r '.[] | "\(.id)\t\(.identifier)\t\(.name)"'; }

upload() { "${CURL[@]}" "${AUTH[@]}" -F "file=@$1" "$API/upload"; }   # -> {id,path,...}

provider_for() { # channel id -> provider
  local kv; IFS=, read -ra kv <<<"$POSTIZ_PROVIDERS"
  for p in "${kv[@]}"; do [ "${p%%=*}" = "$1" ] && { echo "${p#*=}"; return; }; done
}

post() {
  local caption="$1"; shift
  local images='[]' f up
  for f in "$@"; do
    up=$(upload "$f")
    images=$(jq -c --argjson u "$up" '. + [{id:$u.id, path:$u.path}]' <<<"$images")
  done
  local date; date=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  local posts='[]' ch prov
  IFS=, read -ra chs <<<"$POSTIZ_CHANNELS"
  for ch in "${chs[@]}"; do
    prov=$(provider_for "$ch")
    posts=$(jq -c --arg ch "$ch" --arg c "$caption" --arg prov "${prov:-}" --argjson img "$images" \
      '. + [{integration:{id:$ch}, value:[{content:$c, image:$img}], settings:(if $prov=="" then {} else {__type:$prov} end)}]' <<<"$posts")
  done
  jq -nc --arg t "${POSTIZ_MODE:-draft}" --arg d "$date" --argjson p "$posts" \
    '{type:$t, date:$d, shortLink:false, tags:[], posts:$p}' \
  | "${CURL[@]}" "${AUTH[@]}" -H 'Content-Type: application/json' -d @- "$API/posts"
  echo
}

outbox() {
  mkdir -p outbox sent
  shopt -s nullglob
  for f in outbox/*.jpg outbox/*.jpeg outbox/*.png outbox/*.mp4; do
    cap=""; [ -f "${f%.*}.txt" ] && cap=$(<"${f%.*}.txt")
    if post "$cap" "$f"; then
      mv "$f" sent/; [ -f "${f%.*}.txt" ] && mv "${f%.*}.txt" sent/
      echo "$(date -Is) sent $f" >> postiz.log
    else
      echo "$(date -Is) FAILED $f" >> postiz.log
    fi
  done
}

case "${1:-}" in
  channels) channels ;;
  post)     shift; post "$@" ;;
  outbox)   outbox ;;
  *) echo "usage: $0 channels | post \"caption\" [files...] | outbox" >&2; exit 2 ;;
esac
