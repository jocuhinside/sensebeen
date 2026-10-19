# DocuSeal loader for signing packages

Turns a `.docx` package (zip or folder) into DocuSeal templates with a field on every signature and fill line. Creates templates only: no submissions, no emails, nothing sent.

1. `cp facts.example.json facts.local.json` and edit: party role patterns, signing order, and exact-string fills for blanks you know. Fills apply only where the exact text appears, optionally only inside the signature block whose caption matches (`"caption": "^SENSEBEEN"`).
2. `python3 -I prep.py PACKAGE.zip --facts facts.local.json --out work`
   - fills the `.docx`, converts with LibreOffice, finds every `____` run, `[___]` blank and bare `By:`/`Date:` label in the rendered PDF, and assigns each to the party whose block it sits in (block caption first, else the nearest name line)
   - writes `work/<doc>.payload.json`, `work/manifest.json`, `work/report.json` (fills applied, blanks still open, lines it could not attribute) and `work/qa/*.png` (pages with every field box drawn, colored by party)
   - blanks in body text (amounts, percentages) become optional `Prefill:` fields on the sender role, to fill when creating the submission
3. Look at every `work/qa/*.png` and `report.json` `needs_review` before loading.
4. `node load.mjs work/manifest.json --dry-run`, then for real:
   - `DOCUSEAL_API_KEY=... node load.mjs work/manifest.json --no-shots`, or
   - `DOCUSEAL_EMAIL=... DOCUSEAL_PASSWORD=... node load.mjs work/manifest.json`: Playwright signs in (add `DOCUSEAL_OTP=` if 2FA is on), reads the API key from Settings > API for that run only, and screenshots each template's builder into `work/shots/`
   - `DOCUSEAL_API_BASE` defaults to `https://api.docuseal.com` (`.eu`, or `https://host/api` self-hosted; set `DOCUSEAL_APP_URL` for self-hosted)

Templates upsert on `external_id` (`uat-04-d2`), so a rerun replaces rather than duplicates. Each load is read back and checked for field count and signer roles; `results.json` holds ids and builder URLs.

Never commit packages, `facts.local.json`, or `work/` (gitignored here). `UAT-00` and `UAT-07` are skipped by default (Members-only memo, SenseBeen-internal). DocuSeal cannot complete a notarial certificate: notarized exhibits go out in ink and come back as an upload. Templates loaded here are not reachable through `esign-proxy` until their IDs are added to a client's allowlist.
