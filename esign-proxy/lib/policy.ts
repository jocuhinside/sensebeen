import { createHash, timingSafeEqual } from "node:crypto";

/**
 * One entry per external party allowed to drive DocuSeal through this proxy.
 * Configured as a JSON array in the ESIGN_CLIENTS env var. Only the SHA-256
 * of each bearer token is stored; the token itself is shown once at mint time.
 */
export interface Client {
  id: string; // short slug, e.g. "giles"; stamped into submitter metadata as sb_origin
  token_sha256: string; // hex
  templates: number[]; // DocuSeal template IDs this client may read and submit from
  external_id_prefix: string; // forced onto every submitter external_id, e.g. "njoya-"
  can_download: boolean; // may fetch signed PDFs / audit logs for its own submissions
  can_embed: boolean; // may receive signer links (embed_src/slug). false = links stripped and DocuSeal must email signers
  max_expire_days: number; // every submission gets an expiry no later than this
  force_email_2fa: boolean; // require_email_2fa on every submitter
  allowed_email_domains: string[] | null; // null = any recipient domain
  disabled?: boolean; // kill switch without deleting the entry
}

let cache: { raw: string; clients: Client[] } | null = null;

export function loadClients(): Client[] {
  const raw = process.env.ESIGN_CLIENTS ?? "[]";
  if (cache && cache.raw === raw) return cache.clients;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ESIGN_CLIENTS is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("ESIGN_CLIENTS must be a JSON array");
  const clients = parsed.map((c: any, i: number): Client => {
    const where = `ESIGN_CLIENTS[${i}]`;
    if (typeof c?.id !== "string" || !/^[a-z0-9_-]{2,32}$/.test(c.id)) throw new Error(`${where}.id must be a 2-32 char slug`);
    if (typeof c.token_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(c.token_sha256)) throw new Error(`${where}.token_sha256 must be 64 hex chars`);
    if (!Array.isArray(c.templates) || c.templates.some((t: unknown) => !Number.isInteger(t))) throw new Error(`${where}.templates must be an array of integer template IDs`);
    if (typeof c.external_id_prefix !== "string" || !/^[a-z0-9_-]{2,24}$/.test(c.external_id_prefix)) throw new Error(`${where}.external_id_prefix must be a 2-24 char slug`);
    return {
      id: c.id,
      token_sha256: c.token_sha256,
      templates: c.templates,
      external_id_prefix: c.external_id_prefix,
      can_download: c.can_download === true,
      can_embed: c.can_embed === true,
      max_expire_days: Number.isInteger(c.max_expire_days) && c.max_expire_days > 0 ? Math.min(c.max_expire_days, 365) : 30,
      force_email_2fa: c.force_email_2fa === true,
      allowed_email_domains: Array.isArray(c.allowed_email_domains)
        ? c.allowed_email_domains.map((d: string) => String(d).toLowerCase())
        : null,
      disabled: c.disabled === true,
    };
  });
  const ids = new Set<string>();
  for (const c of clients) {
    if (ids.has(c.id)) throw new Error(`duplicate client id ${c.id}`);
    ids.add(c.id);
  }
  cache = { raw, clients };
  return clients;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Resolve the calling client from an Authorization: Bearer header. Constant-time over all entries. */
export function authenticate(authHeader: string | null): Client | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(\S{20,200})$/.exec(authHeader.trim());
  if (!m) return null;
  const presented = Buffer.from(sha256Hex(m[1]), "hex");
  let match: Client | null = null;
  for (const c of loadClients()) {
    const stored = Buffer.from(c.token_sha256, "hex");
    if (stored.length === presented.length && timingSafeEqual(stored, presented) && !c.disabled) match = c;
  }
  return match;
}

/** Field types a client may prefill. Anything that is an act of signing, attestation, or payment is excluded. */
export const PREFILLABLE_FIELD_TYPES = new Set([
  "text",
  "number",
  "date",
  "checkbox",
  "multiple",
  "radio",
  "select",
  "cells",
  "phone",
]);

export const ALLOWED_SUBMISSION_KEYS = new Set([
  "template_id",
  "send_email",
  "send_sms",
  "order",
  "message",
  "expire_at",
  "variables",
  "submitters",
]);

export const ALLOWED_SUBMITTER_KEYS = new Set([
  "role",
  "email",
  "name",
  "phone",
  "values",
  "external_id",
  "metadata",
  "send_email",
  "send_sms",
  "require_email_2fa",
  "require_phone_2fa",
  "message",
]);

/**
 * Keys refused outright, with the reason returned to the caller.
 * completed: would mark a signer as having signed without them signing.
 * fields: would let the caller relax required/readonly/validation set on the template.
 * completed_redirect_url / reply_to / bcc_completed: route signers or signed copies to arbitrary destinations.
 */
export const REFUSED_KEYS: Record<string, string> = {
  completed: "marks a submitter as signed without their signature",
  fields: "overrides template field rules (required, readonly, validation)",
  completed_redirect_url: "redirects signers to an arbitrary URL",
  reply_to: "reply-to is fixed by the account",
  bcc_completed: "would send signed copies to an arbitrary address",
};
