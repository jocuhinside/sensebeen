# esign-proxy: scoped DocuSeal access

Lets an outside party (first client: Giles / Njoya Engineering) drive DocuSeal programmatically without ever holding the SenseBeen account API key. A DocuSeal key reads and writes every template and submission in the account, including instruments where the client is the counterparty. This proxy holds that key server-side and exposes a narrow surface per client.

Submissions created here live in the same DocuSeal account, so the existing account webhook (sensebeen.com, Good Cloud filing, ML-DSA-65 ledger entry, OpenTimestamps anchor) captures them with no change on the capture side. Each submitter carries `metadata.sb_origin=<client>` and `metadata.sb_ref`, which is what makes ledger entries attributable.

## What a client can and cannot do

| Allowed | Refused |
|---|---|
| List / read templates on its allowlist (other templates return 404) | Any template outside the allowlist, template create/clone/edit/archive |
| Create submissions from allowlisted templates | `completed` (marking someone signed), prefilling signature / initials / stamp / image / file / payment / verification fields |
| Prefill text, number, date, checkbox, select, radio, cells, phone | `fields[]` overrides (relaxing required/readonly/validation) |
| Read and list only submissions its own calls created | `bcc_completed`, `reply_to`, `completed_redirect_url` |
| Download signed PDFs + audit log for its own submissions (if `can_download`) | Archive, delete, `PUT` on submissions or submitters |
| | Reading operator-created submissions, even on allowlisted templates |

Further per-client controls: every submitter `external_id` is forced under the client's prefix; `sb_*` metadata keys are reserved; every submission gets an expiry no later than `max_expire_days`; `force_email_2fa` puts an email OTP in front of every signer link; `allowed_email_domains` restricts recipients.

Signer links (`embed_src`, `slug`) are stripped from responses unless `can_embed` is set, and `send_email:false` is refused, so DocuSeal itself delivers the link to the signer. Without this, a sender who receives the link can complete the signature as the signer. Turn `can_embed` on only for a client embedding signing in its own product, and pair it with `force_email_2fa`.

## Deploy

Separate Vercel project from the website, so the master key sits in a project with no other code and v0 regenerations can never touch it.

1. Vercel: New Project, import `jocuhinside/sensebeen`, **Root Directory `esign-proxy`**, framework Next.js.
2. Env vars (Production only): `DOCUSEAL_API_KEY`, `DOCUSEAL_API_BASE` (`https://api.docuseal.com`, or `.eu`), `ESIGN_CLIENTS`.
3. Domain: `esign-api.sensebeen.com` (CNAME at Unstoppable Domains to `cname.vercel-dns.com`).
4. Mint Giles's token locally and add the printed entry to `ESIGN_CLIENTS`:
   ```
   cd esign-proxy && npm ci
   npm run mint -- giles --templates <ids> --prefix njoya- --download --email-2fa
   ```
   Redeploy after editing the env var. Hand the token over Signal or Proton (end to end), never in a repo, issue, or plain email.

Same Node runtime can run on sensebeen-server instead (`npm ci && npm run build && npm start`, behind the Cloudflare tunnel) if you would rather keep the master key off Vercel entirely.

## Operate

- **Grant a template:** add its ID to the client's `templates`, redeploy.
- **Revoke:** set `"disabled": true` on the entry (or delete it), redeploy. Takes effect on the next request.
- **Rotate:** mint a new token, replace `token_sha256`, redeploy, send the new token.
- **Audit:** one JSON line per call in the project's runtime logs: client, method, path, status, and on create the `submission_id` and `sb_ref`. The ledger entry from the webhook is the durable record; logs are the access trail.

## Test

`npm test` builds the app and runs `test/run.sh` against `test/mock-docuseal.mjs` (40 assertions: auth, allowlist, every refused key, ownership isolation, link stripping, upstream never receives DELETE/PUT, master key never in responses or logs). The mock is shaped from DocuSeal's public API docs; run one real submission against a test template before handing the token over.

## Limits

- Listing scans the most recent 100 submissions per allowlisted template, then filters to the client's own. Fine at current volume; add a ledger-backed index if a template gets heavy traffic.
- No rate limiting (serverless instances do not share memory). Vercel Firewall rate-limit rule on `/api/esign/*` is the cheap fix if needed.
- API-created completions bill at DocuSeal's per-document API rate.
