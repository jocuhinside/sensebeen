# Gig replies through Proton Bridge

Sends the replies in `replies/` from your Proton address through Bridge's local SMTP (`127.0.0.1:1025`, STARTTLS). Dry run unless `--send`. Needs only Python 3; Bridge must be running and logged in (see `../mail-setup`).

1. `cp profile.example.json profile.local.json` and fill it in. `email` is your Proton address (also the Bridge username). `resume` and `photos` are paths to the files posts ask for. Set `"car": true` only if you have a car, license and insurance; three posts require it.
2. Craigslist posts have no public address. For each one you want to send: open the `Post:` link, tap Reply, copy the relay address, and add it to `to.local.json`:
   ```json
   { "01-ai-conference": "abc123def@job.craigslist.org", "10-ignite-atn": "..." }
   ```
   Posts with a `To:` header (04, 12) already have one.
3. `python3 -I send.py` lists every reply as READY or SKIP with the reason (no address, missing profile field, missing attachment, needs a car, expired, already sent). `--show` prints the full messages. `--only 01,04,10` limits the run.
4. `python3 -I send.py --send` asks you to type `send`, then prompts for the Bridge password (from `info` in `protonmail-bridge --cli`; it is not your Proton password). `--pass-entry ENTRY` reads it from `pass` instead, or set `BRIDGE_PASSWORD`.

TLS is verified against Bridge's own certificate: `~/.config/protonmail/bridge-v3/cert.pem` by default, otherwise export it (Settings > Advanced > Export TLS certificates) and pass `--cafile`. If Bridge's SMTP is set to SSL instead of STARTTLS, add `--ssl`.

Each send is logged to `sent.local.json`, and a rerun skips those ids (`--resend` overrides). Replies whose `Expires:` date has passed are skipped. Sends are spaced 8 s apart (`--delay`).

Reply files are plain text: headers (`Post`, `To`, `Subject`, `Attach`: resume / photo / photos, `Requires`: car, `Expires`, `Pay`, `Note`), a blank line, then the body. `{name}`, `{phone}`, `{email}`, `{area}`, `{avail}`, `{exp}`, `{age}`, `{ig}`, `{video}` come from the profile; `{sig}` is name, phone and email. A reply with any empty field is skipped, never sent half-filled. Edit or delete files freely.
