# DocuSeal loader for signing packages

Turns a `.docx` package (zip, folder, or one file) into DocuSeal templates with a field on every signature and fill line. Creates templates only: no submissions, no emails, nothing sent.

1. `cp facts.example.json facts.local.json` and edit it (keys below).
2. `python3 -I prep.py PACKAGE.zip --facts facts.local.json --out work`
   - fills the `.docx`: `fill` replaces exact text you know; every remaining `[___]` becomes a line sized to fit on one line of its table cell, so nothing wraps or overflows once filled
   - converts with LibreOffice and splits exhibits into their own parts on their headings (`parts`), so a per-nominee certificate or a notarized ink page is its own document
   - finds every signature line (underscore runs and rules drawn as borders), fill line and `[ ]` checkbox, and assigns each to a party: the block caption first (`roles`), else the blank's owner rule (`blanks`), else the document's sender (`sender_by_doc`)
   - writes `work/<part>.payload.json`, `work/manifest.json`, `work/report.json` (what was filled, brackets still open, lines it could not attribute) and `work/qa/*.png` (each page with every field box drawn, colored by party)
3. Look at every `work/qa/*.png` and `report.json` before loading.
4. `node load.mjs work/manifest.json --dry-run`, then for real:
   - `node --env-file=/path/to/.env load.mjs work/manifest.json --no-shots` (key as `DOCUSEAL_API_KEY`, `DOCUSEAL_API_TOKEN` or `DOCUSEAL_TOKEN`), or
   - `DOCUSEAL_EMAIL=... DOCUSEAL_PASSWORD=... node load.mjs work/manifest.json`: Playwright signs in (add `DOCUSEAL_OTP=` if 2FA is on), reads the API key from Settings > API for that run only, and screenshots each template's builder into `work/shots/`
   - `DOCUSEAL_API_BASE` defaults to `https://api.docuseal.com` (`.eu`, or `https://host/api` self-hosted; set `DOCUSEAL_APP_URL` for self-hosted)

A work folder can be zipped and run on another machine: `@file:` paths resolve relative to the manifest.

Templates upsert on `external_id` (`uat-06a-exa-d2`), so a rerun replaces rather than duplicates. Each load is read back and checked for field count and signer roles. Earlier templates for the same `UAT-NN` document (uploaded by hand, say) are listed in `results.json` as superseded; `--archive-old` archives them, which DocuSeal can undo.

## facts.local.json

| Key | Meaning |
|---|---|
| `fill` | `{find, replace}` exact text you know, or `{find, blank: n}` to turn a bracket into an n-character line; `docs` and `caption` scope a rule |
| `blanks` | per `[___]`: `ctx` regex on the text just before it (row label included), `width`, `owner` role, field `name`, optional `docs`, `x` [min, max] page fraction, `page`, `type` (`file` for uploads), `same: true` to show one value wherever it recurs |
| `checks` | the same, for `[ ]` checkboxes |
| `roles` | `[caption regex, role, [docs]]`; role may use `\1` groups and `{name}` (the printed name in the block) |
| `parts` | per document, `[{suffix, name, starts: [heading regex], esign}]`; `esign: false` makes an ink-only PDF |
| `sender_by_doc` | who fills unowned blanks in each document (default `sender_role`) |
| `skip`, `role_order`, `folder`, `rev`, `date_format` | as named |

Never commit packages, `facts.local.json`, or `work/` (gitignored here). DocuSeal cannot complete a notarial certificate: notarized exhibits go out in ink and come back as an upload. Templates loaded here are not reachable through `esign-proxy` until their IDs are added to a client's allowlist.
