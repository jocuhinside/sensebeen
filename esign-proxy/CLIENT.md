# SenseBeen E-Sign API: client guide

For Giles Domkam / Njoya Engineering. You drive DocuSeal through a SenseBeen endpoint with your own token. Everything you create is captured into the SenseBeen signing ledger (hash-chained, ML-DSA-65 signed, anchored to Bitcoin via OpenTimestamps) the moment it completes.

**Base URL:** `https://esign-api.sensebeen.com/api/esign/v1`
**Auth:** `Authorization: Bearer <your token>` (delivered separately, end to end; treat it like an SSH key)

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/whoami` | Your scopes: template IDs, external_id prefix, download/embed rights, expiry ceiling |
| GET | `/templates` | Your templates with roles and fields (`prefillable` marks which you may set) |
| GET | `/templates/{id}` | One template |
| POST | `/submissions` | Creates a signing request; returns `submission_id`, `sb_ref`, submitters |
| GET | `/submissions?status=&template_id=&limit=` | Submissions you created |
| GET | `/submissions/{id}` | Status, submitter states, `audit_log_url`, values |
| GET | `/submissions/{id}/documents?merge=true` | Signed PDF URLs |

Request and response bodies follow DocuSeal's API (docuseal.com/docs/api) with the rules below.

## Rules

- `external_id` on each submitter is prefixed `njoya-` if you do not prefix it yourself. Put your test-run or ticket ID there for correlation.
- `metadata` is yours, except keys beginning `sb_`, which are set by the proxy.
- You may prefill text, number, date, checkbox, select, radio, cells and phone fields. Signature, initials, stamp, image, file and verification fields are always completed by the signer.
- Signers get their link by email from DocuSeal; links are not returned to the API. `send_email:false` is refused.
- Every submission expires; omit `expire_at` to take the default ceiling.
- Not available: `completed`, `fields[]` overrides, `bcc_completed`, `reply_to`, `completed_redirect_url`, archiving, editing templates or submitters. Refused requests return 422 with the reason.
- Templates and submissions outside your scope return 404.

## Examples

```bash
export SB=https://esign-api.sensebeen.com/api/esign/v1
export TOK=sbk_giles_...        # from your secrets store, not shell history

curl -s $SB/whoami -H "Authorization: Bearer $TOK"
curl -s $SB/templates -H "Authorization: Bearer $TOK" | jq '.data[] | {id,name,roles}'

curl -s -X POST $SB/submissions -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{
  "template_id": 101,
  "submitters": [
    { "role": "Engineer", "email": "you@njoya.example", "external_id": "interop-run-14",
      "values": { "Full Name": "Giles Domkam" }, "metadata": { "suite": "pq-interop" } },
    { "role": "SenseBeen", "email": "ops@sensebeen.com" }
  ]
}'

curl -s "$SB/submissions?status=completed" -H "Authorization: Bearer $TOK" | jq '.data[] | {id,status,completed_at}'
curl -s "$SB/submissions/612/documents?merge=true" -H "Authorization: Bearer $TOK"
```

Need another template in scope, embedded signing, or a higher expiry ceiling: ask Louys. Token compromise: tell Louys immediately; revocation is one config change.
