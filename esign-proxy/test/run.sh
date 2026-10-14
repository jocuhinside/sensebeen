#!/usr/bin/env bash
# End-to-end policy tests: builds the proxy, runs it against test/mock-docuseal.mjs, asserts every guard.
set -uo pipefail
cd "$(dirname "$0")/.."
MOCK_PORT=3199; PORT=3198; BASE="http://127.0.0.1:$PORT/api/esign/v1"
TOK_G="sbk_giles_testtoken_aaaaaaaaaaaaaaaaaaaaaaaa"
TOK_X="sbk_other_testtoken_bbbbbbbbbbbbbbbbbbbbbbbb"
h() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
export DOCUSEAL_API_KEY=master-key-test DOCUSEAL_API_BASE="http://127.0.0.1:$MOCK_PORT"
export ESIGN_CLIENTS="[{\"id\":\"giles\",\"token_sha256\":\"$(h $TOK_G)\",\"templates\":[101,102],\"external_id_prefix\":\"njoya-\",\"can_download\":true,\"max_expire_days\":30},{\"id\":\"other\",\"token_sha256\":\"$(h $TOK_X)\",\"templates\":[101],\"external_id_prefix\":\"oth-\",\"disabled\":true}]"

[ -d .next ] || npx next build >/dev/null || { echo "build failed"; exit 1; }
MOCK_PORT=$MOCK_PORT node test/mock-docuseal.mjs & MP=$!
npx next start -p $PORT >/tmp/esign-proxy-test.log 2>&1 & NP=$!
trap 'kill $MP $NP 2>/dev/null' EXIT
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:$MOCK_PORT/__calls" && curl -s -o /dev/null "$BASE/whoami" && break; sleep 0.5; done

PASS=0; FAIL=0
t() { # name expected_status method path [token] [body]
  local name=$1 want=$2 m=$3 p=$4 tok=${5-$TOK_G} body=${6:-}
  local args=(-s -o /tmp/esign-resp.json -w '%{http_code}' -X "$m" "$BASE$p")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  local got; got=$(curl "${args[@]}")
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); printf 'ok   %-55s %s\n' "$name" "$got"
  else FAIL=$((FAIL+1)); printf 'FAIL %-55s want %s got %s: %s\n' "$name" "$want" "$got" "$(head -c 300 /tmp/esign-resp.json)"; fi
}
jqr() { jq -r "$1" /tmp/esign-resp.json; }
assert() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf 'ok   %s\n' "$1"; else FAIL=$((FAIL+1)); printf 'FAIL %s: want [%s] got [%s]\n' "$1" "$3" "$2"; fi; }

t "no token"                                  401 GET /whoami ""
t "wrong token"                               401 GET /whoami "sbk_giles_wrongwrongwrongwrongwrong"
t "disabled client"                           401 GET /whoami "$TOK_X"
t "whoami"                                    200 GET /whoami
assert "whoami does not leak master key"      "$(grep -c master-key-test /tmp/esign-resp.json)" 0
t "list templates (allowlist only)"           200 GET /templates
assert "template count = 2"                   "$(jqr '.data|length')" 2
assert "signature not prefillable"            "$(jqr '.data[0].fields[]|select(.name=="Signature").prefillable')" false
t "non-allowlisted template hidden"           404 GET /templates/999
t "create on non-allowlisted template"        404 POST /submissions "$TOK_G" '{"template_id":999,"submitters":[{"role":"Assignor","email":"a@b.c"}]}'
t "refuse completed=true"                     422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"a@b.c","completed":true}]}'
t "refuse signature prefill"                  422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"a@b.c","values":{"Signature":"https://img/sig.png"}}]}'
t "refuse bcc_completed"                      422 POST /submissions "$TOK_G" '{"template_id":101,"bcc_completed":"x@evil.com","submitters":[{"role":"Engineer","email":"a@b.c"}]}'
t "refuse fields override"                    422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"a@b.c","fields":[{"name":"Signature","required":false}]}]}'
t "refuse redirect url"                       422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"a@b.c","completed_redirect_url":"https://evil"}]}'
t "refuse unknown role"                       422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Ghost","email":"a@b.c"}]}'
t "refuse reserved metadata"                  422 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"a@b.c","metadata":{"sb_origin":"op"}}]}'
t "refuse send_email false without embed"     422 POST /submissions "$TOK_G" '{"template_id":101,"send_email":false,"submitters":[{"role":"Engineer","email":"a@b.c"}]}'
t "refuse expiry past ceiling"                422 POST /submissions "$TOK_G" '{"template_id":101,"expire_at":"2099-01-01T00:00:00Z","submitters":[{"role":"Engineer","email":"a@b.c"}]}'
t "refuse unsupported key"                    422 POST /submissions "$TOK_G" '{"template_id":101,"foo":1,"submitters":[{"role":"Engineer","email":"a@b.c"}]}'
t "create ok (text prefill allowed)"          201 POST /submissions "$TOK_G" '{"template_id":101,"submitters":[{"role":"Engineer","email":"g@njoya.test","external_id":"run-7","values":{"Full Name":"Giles Domkam"},"metadata":{"suite":"interop"}},{"role":"SenseBeen","email":"ops@sensebeen.com"}]}'
SID=$(jqr .submission_id)
assert "external_id prefixed"                 "$(jqr '.submitters[0].external_id')" "njoya-run-7"
assert "origin stamped"                       "$(jqr '.submitters[0].metadata.sb_origin')" "giles"
assert "caller metadata kept"                 "$(jqr '.submitters[0].metadata.suite')" "interop"
assert "signer link stripped"                 "$(jqr '.submitters[0].embed_src // "none"')" "none"
assert "expiry always set"                    "$(jqr '.expire_at|length>0')" true
t "get own submission"                        200 GET "/submissions/$SID"
assert "operator identity stripped"           "$(jqr '.created_by_user // "none"')" "none"
t "operator submission on same template"      404 GET /submissions/500
t "own-tagged sub on non-allowlisted tpl"     404 GET /submissions/501
t "list sees only own"                        200 GET /submissions
assert "list returns exactly the one created" "$(jqr '[.data[].id]|join(",")')" "$SID"
t "download own docs"                         200 GET "/submissions/$SID/documents?merge=true"
t "download operator docs"                    404 GET /submissions/500/documents
t "archive blocked"                           405 DELETE "/submissions/$SID"
t "template create blocked"                   405 POST /templates/pdf "$TOK_G" '{}'
t "submitter update blocked"                  405 PUT /submitters/10 "$TOK_G" '{"completed":true}'

UP=$(curl -s "http://127.0.0.1:$MOCK_PORT/__calls")
assert "upstream never received DELETE/PUT"   "$(printf '%s' "$UP" | jq '[.[]|select(.method=="DELETE" or .method=="PUT")]|length')" 0
assert "upstream received exactly 1 POST"     "$(printf '%s' "$UP" | jq '[.[]|select(.method=="POST")]|length')" 1
assert "master key absent from proxy logs"    "$(grep -c master-key-test /tmp/esign-proxy-test.log)" 0

echo "----"; echo "pass $PASS  fail $FAIL"
[ "$FAIL" -eq 0 ]
