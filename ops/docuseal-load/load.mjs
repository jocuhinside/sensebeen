#!/usr/bin/env node
// Push prep.py payloads to DocuSeal as templates (upsert by external_id), verify each one by
// read-back, screenshot it in the template builder, and list older uploads of the same UAT
// document as superseded (archived only with --archive-old; DocuSeal can unarchive).
//
//   DOCUSEAL_API_KEY=... node load.mjs WORK/manifest.json [--dry-run] [--no-shots]
//   DOCUSEAL_EMAIL=... DOCUSEAL_PASSWORD=... [DOCUSEAL_OTP=123456] node load.mjs WORK/manifest.json
//
// Without an API key, Playwright signs in and reads the key from Settings > API for this run
// only; it is never written to disk or printed. Creates templates only: no submissions, no email.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const manifestPath = args.find((a) => !a.startsWith("--"));
if (!manifestPath) {
  console.error("usage: node load.mjs WORK/manifest.json [--dry-run] [--no-shots]");
  process.exit(2);
}
const DRY = args.includes("--dry-run");
const ARCHIVE_OLD = args.includes("--archive-old");
const SHOTS = !args.includes("--no-shots");
const work = path.dirname(path.resolve(manifestPath));
const API = (process.env.DOCUSEAL_API_BASE ?? "https://api.docuseal.com").replace(/\/+$/, "");
const APP = (process.env.DOCUSEAL_APP_URL ?? API.replace("//api.", "//").replace(/\/api$/, "")).replace(/\/+$/, "");
const { DOCUSEAL_EMAIL: EMAIL, DOCUSEAL_PASSWORD: PASS, DOCUSEAL_OTP: OTP } = process.env;
let KEY = process.env.DOCUSEAL_API_KEY;

function playwright() {
  try {
    return require("playwright");
  } catch {
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
  }
}

async function signIn(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${APP}/sign_in`, { waitUntil: "domcontentloaded" });
  await page.fill("#user_email", EMAIL);
  await page.fill("#user_password", PASS);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("form#new_user button[type=submit]")]);
  const otp = page.locator('input[name="user[otp_attempt]"]');
  if (await otp.count()) {
    if (!OTP) throw new Error("DocuSeal asks for a 2FA code: rerun with DOCUSEAL_OTP=<code>");
    await otp.fill(OTP);
    await Promise.all([page.waitForLoadState("networkidle"), page.keyboard.press("Enter")]);
  }
  if (/sign_in/.test(page.url())) {
    await page.screenshot({ path: path.join(work, "shots", "sign-in-failed.png") });
    throw new Error("DocuSeal sign-in failed (screenshot in shots/sign-in-failed.png)");
  }
  return { ctx, page };
}

async function keyFromSettings(page) {
  await page.goto(`${APP}/settings/api`, { waitUntil: "networkidle" });
  for (const name of [/reveal/i, /show/i]) {
    const b = page.getByRole("button", { name });
    if (await b.count()) await b.first().click().catch(() => {});
  }
  const vals = await page.$$eval("input:not([type=hidden]), code, pre", (els) =>
    els.map((e) => (e.value || e.textContent || "").trim()),
  );
  const key = vals.find((v) => /^[A-Za-z0-9]{30,64}$/.test(v));
  if (!key) {
    await page.screenshot({ path: path.join(work, "shots", "api-settings.png") });
    throw new Error("No API key visible on Settings > API (screenshot in shots/api-settings.png)");
  }
  return key;
}

async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { "X-Auth-Token": KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let j = text;
  try {
    j = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

function withFiles(payload) {
  const p = structuredClone(payload);
  for (const d of p.documents) {
    if (d.file.startsWith("@file:")) d.file = fs.readFileSync(d.file.slice(6)).toString("base64");
  }
  return p;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
fs.mkdirSync(path.join(work, "shots"), { recursive: true });

if (DRY) {
  for (const f of manifest) {
    const p = JSON.parse(fs.readFileSync(f, "utf8"));
    const fields = p.documents.flatMap((d) => d.fields);
    const roles = [...new Set(fields.map((x) => x.role))];
    console.log(`${p.external_id}  ${p.name}  [${p.folder_name}]  ${fields.length} fields  roles: ${roles.join(", ")}`);
  }
  process.exit(0);
}

let browser, session;
if (!KEY || SHOTS) {
  if (EMAIL && PASS) {
    browser = await playwright().chromium.launch();
    session = await signIn(browser);
    if (!KEY) KEY = await keyFromSettings(session.page);
  } else if (!KEY) {
    console.error("Set DOCUSEAL_API_KEY, or DOCUSEAL_EMAIL and DOCUSEAL_PASSWORD");
    process.exit(2);
  }
}

const results = [];
let failed = 0;
for (const f of manifest) {
  const payload = JSON.parse(fs.readFileSync(f, "utf8"));
  const want = payload.documents.flatMap((d) => d.fields);
  try {
    const t = await api("POST", "/templates/pdf", withFiles(payload));
    const back = await api("GET", `/templates/${t.id}`);
    const gotRoles = (back.submitters ?? []).map((s) => s.name);
    const wantRoles = [...new Set(want.map((x) => x.role))];
    const ok = (back.fields ?? []).length === want.length && wantRoles.every((r) => gotRoles.includes(r));
    const row = { external_id: payload.external_id, id: t.id, name: back.name, folder: back.folder_name,
      url: `${APP}/templates/${t.id}`, fields: (back.fields ?? []).length, expected_fields: want.length,
      submitters: gotRoles, verified: ok };
    if (session && SHOTS) {
      const shot = path.join(work, "shots", `${payload.external_id}.png`);
      await session.page.goto(`${APP}/templates/${t.id}/edit`, { waitUntil: "networkidle" });
      await session.page.waitForTimeout(1500);
      await session.page.screenshot({ path: shot, fullPage: true });
      row.screenshot = shot;
    }
    // Older uploads of the same document (e.g. "UAT-06A..." added by hand) are superseded by this one.
    // Listed always; archived only with --archive-old (DocuSeal archive is reversible: PUT archived:false).
    const key = (payload.name.match(/^UAT-\d+[A-Z]?/) || [])[0];
    if (key && ok) {
      const found = await api("GET", `/templates?q=${encodeURIComponent(key)}&limit=100`);
      const old = (found.data ?? found).filter((x) => x.id !== t.id && !(x.external_id || "").startsWith(key.toLowerCase())
        && new RegExp(`(^|[^A-Z0-9])${key}(?![A-Z0-9])`).test(x.name));
      row.superseded = old.map((x) => ({ id: x.id, name: x.name, archived: false }));
      for (const o of row.superseded) {
        if (!ARCHIVE_OLD) continue;
        await api("DELETE", `/templates/${o.id}`);
        o.archived = true;
      }
    }
    results.push(row);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "MISMATCH"} ${payload.external_id} -> #${t.id} ${row.fields}/${want.length} fields, ${gotRoles.join(", ")}`
      + (row.superseded?.length ? `; supersedes ${row.superseded.map((o) => `#${o.id}${o.archived ? " (archived)" : ""}`).join(", ")}` : ""));
  } catch (e) {
    failed++;
    results.push({ external_id: payload.external_id, error: String(e.message) });
    console.log(`FAIL ${payload.external_id}: ${e.message}`);
  }
}
fs.writeFileSync(path.join(work, "results.json"), JSON.stringify(results, null, 1));
if (browser) await browser.close();
console.log(`${results.length - failed}/${results.length} templates loaded and verified -> ${path.join(work, "results.json")}`);
process.exit(failed ? 1 : 0);
