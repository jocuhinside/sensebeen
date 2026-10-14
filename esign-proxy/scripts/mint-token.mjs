#!/usr/bin/env node
// Mint a bearer token for one proxy client and print the ESIGN_CLIENTS entry to paste.
//   node scripts/mint-token.mjs giles --templates 123,456 --prefix njoya- [--download] [--embed] [--email-2fa] [--domains a.com,b.org] [--expire-days 30]
// The token prints once, to stdout. Only its SHA-256 goes into config. Hand the token over an end-to-end channel.
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith("--") || !/^[a-z0-9_-]{2,32}$/.test(id)) {
  console.error("usage: mint-token.mjs <client-id> --templates 1,2 --prefix njoya- [--download] [--embed] [--email-2fa] [--domains x.com] [--expire-days 30]");
  process.exit(2);
}
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const templates = (opt("--templates") ?? "")
  .split(",")
  .filter(Boolean)
  .map((t) => {
    const n = Number(t);
    if (!Number.isInteger(n)) throw new Error(`bad template id ${t}`);
    return n;
  });
const prefix = opt("--prefix") ?? `${id}-`;
const token = `sbk_${id}_${randomBytes(32).toString("base64url")}`;
const entry = {
  id,
  token_sha256: createHash("sha256").update(token).digest("hex"),
  templates,
  external_id_prefix: prefix,
  can_download: flag("--download"),
  can_embed: flag("--embed"),
  max_expire_days: Number(opt("--expire-days") ?? 30),
  force_email_2fa: flag("--email-2fa"),
  allowed_email_domains: opt("--domains") ? opt("--domains").split(",") : null,
};

console.log("TOKEN (give to client once, never commit):");
console.log(token);
console.log("\nESIGN_CLIENTS entry (add to the JSON array):");
console.log(JSON.stringify(entry));
