import { ds } from "./docuseal";
import {
  ALLOWED_SUBMISSION_KEYS,
  ALLOWED_SUBMITTER_KEYS,
  type Client,
  PREFILLABLE_FIELD_TYPES,
  REFUSED_KEYS,
} from "./policy";

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

type Json = Record<string, any>;
const LINK_KEYS = ["embed_src", "slug"];

// ---------- templates ----------

function assertTemplateAllowed(client: Client, id: number) {
  if (!client.templates.includes(id)) throw new HttpError(404, "template not found");
}

async function fetchTemplate(id: number): Promise<Json> {
  return ds("GET", `/templates/${id}`);
}

function shapeTemplate(t: Json) {
  const roleByUuid = new Map<string, string>((t.submitters ?? []).map((s: Json) => [s.uuid, s.name]));
  return {
    id: t.id,
    name: t.name,
    external_id: t.external_id ?? null,
    roles: (t.submitters ?? []).map((s: Json) => s.name),
    fields: (t.fields ?? []).map((f: Json) => ({
      name: f.name,
      type: f.type,
      required: !!f.required,
      role: roleByUuid.get(f.submitter_uuid) ?? null,
      prefillable: PREFILLABLE_FIELD_TYPES.has(f.type),
    })),
  };
}

export async function listTemplates(client: Client) {
  const out = [];
  for (const id of client.templates) {
    try {
      out.push(shapeTemplate(await fetchTemplate(id)));
    } catch {
      out.push({ id, error: "unavailable" });
    }
  }
  return { data: out };
}

export async function getTemplate(client: Client, id: number) {
  assertTemplateAllowed(client, id);
  return shapeTemplate(await fetchTemplate(id));
}

// ---------- ownership + shaping ----------

function ownedBy(client: Client, sub: Json): boolean {
  const tid = sub.template?.id ?? sub.template_id;
  if (!client.templates.includes(Number(tid))) return false;
  return (sub.submitters ?? []).some((s: Json) => s?.metadata?.sb_origin === client.id);
}

function scrub(client: Client, obj: Json): Json {
  const o: Json = { ...obj };
  delete o.created_by_user; // account operator identity is not the client's business
  if (!client.can_embed) for (const k of LINK_KEYS) delete o[k];
  if (Array.isArray(o.submitters)) {
    o.submitters = o.submitters.map((s: Json) => {
      const c = { ...s };
      if (!client.can_embed) for (const k of LINK_KEYS) delete c[k];
      return c;
    });
  }
  return o;
}

async function fetchOwnedSubmission(client: Client, id: number): Promise<Json> {
  let sub: Json;
  try {
    sub = await ds("GET", `/submissions/${id}`);
  } catch {
    throw new HttpError(404, "submission not found");
  }
  if (!ownedBy(client, sub)) throw new HttpError(404, "submission not found"); // indistinguishable from nonexistent
  return sub;
}

// ---------- submissions: read ----------

export async function listSubmissions(client: Client, q: URLSearchParams) {
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 25) || 25, 1), 100);
  const status = q.get("status") ?? undefined;
  if (status && !["completed", "declined", "expired", "pending"].includes(status)) throw new HttpError(400, "bad status");
  const tq = q.get("template_id");
  const templates = tq ? [Number(tq)] : client.templates;
  if (tq) assertTemplateAllowed(client, templates[0]);

  const found: Json[] = [];
  for (const template_id of templates) {
    const page: Json = await ds("GET", "/submissions", { query: { template_id, status, limit: 100, archived: false } });
    for (const item of page.data ?? []) {
      // list rows may omit submitter metadata; fall back to the detail record before deciding ownership
      const hasMeta = (item.submitters ?? []).some((s: Json) => s && "metadata" in s);
      const full = hasMeta ? { ...item, template_id } : await ds("GET", `/submissions/${item.id}`).catch(() => null);
      if (full && ownedBy(client, { template_id, ...full })) found.push(full);
    }
  }
  found.sort((a, b) => Number(b.id) - Number(a.id));
  return {
    data: found.slice(0, limit).map((s) => scrub(client, s)),
    note: "Most recent 100 submissions per allowlisted template are scanned. Filter with template_id and status.",
  };
}

export async function getSubmission(client: Client, id: number) {
  return scrub(client, await fetchOwnedSubmission(client, id));
}

export async function getSubmissionDocuments(client: Client, id: number, merge: boolean) {
  if (!client.can_download) throw new HttpError(403, "document download not enabled for this client");
  await fetchOwnedSubmission(client, id);
  return ds("GET", `/submissions/${id}/documents`, { query: { merge } });
}

// ---------- submissions: create ----------

function refuseUnknown(obj: Json, allowed: Set<string>, where: string) {
  const bad: string[] = [];
  for (const k of Object.keys(obj)) {
    if (REFUSED_KEYS[k]) throw new HttpError(422, `${where}.${k} is not permitted: ${REFUSED_KEYS[k]}`);
    if (!allowed.has(k)) bad.push(k);
  }
  if (bad.length) throw new HttpError(422, `${where}: unsupported keys ${bad.join(", ")}`);
}

export async function createSubmission(client: Client, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "JSON object body required");
  const b = body as Json;
  refuseUnknown(b, ALLOWED_SUBMISSION_KEYS, "body");

  const templateId = Number(b.template_id);
  if (!Number.isInteger(templateId)) throw new HttpError(400, "template_id required");
  assertTemplateAllowed(client, templateId);
  const tpl = await fetchTemplate(templateId);
  const roles = new Set<string>((tpl.submitters ?? []).map((s: Json) => s.name));
  const fieldTypes = new Map<string, Set<string>>();
  for (const f of tpl.fields ?? []) {
    if (!fieldTypes.has(f.name)) fieldTypes.set(f.name, new Set());
    fieldTypes.get(f.name)!.add(f.type);
  }

  if (!Array.isArray(b.submitters) || b.submitters.length === 0) throw new HttpError(400, "submitters[] required");
  if (b.submitters.length > 20) throw new HttpError(400, "too many submitters");

  // expiry: always present, never beyond the client's ceiling
  const ceiling = Date.now() + client.max_expire_days * 86_400_000;
  let expireAt = ceiling;
  if (b.expire_at !== undefined) {
    const t = Date.parse(String(b.expire_at));
    if (Number.isNaN(t)) throw new HttpError(400, "expire_at is not a date");
    if (t > ceiling) throw new HttpError(422, `expire_at exceeds ${client.max_expire_days} day limit`);
    expireAt = t;
  }

  const ref = `${client.external_id_prefix}${Date.now().toString(36)}`;
  const submitters = b.submitters.map((raw: unknown, i: number) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, `submitters[${i}] must be an object`);
    const s = raw as Json;
    const where = `submitters[${i}]`;
    refuseUnknown(s, ALLOWED_SUBMITTER_KEYS, where);

    if (s.role !== undefined && !roles.has(s.role)) throw new HttpError(422, `${where}.role must be one of: ${[...roles].join(", ")}`);
    if (!s.email && !s.phone) throw new HttpError(400, `${where} needs email or phone`);
    if (s.email && client.allowed_email_domains) {
      const domain = String(s.email).split("@").pop()?.toLowerCase() ?? "";
      if (!client.allowed_email_domains.includes(domain)) throw new HttpError(422, `${where}.email domain not permitted for this client`);
    }

    if (s.values !== undefined) {
      if (typeof s.values !== "object" || Array.isArray(s.values)) throw new HttpError(400, `${where}.values must be an object`);
      for (const name of Object.keys(s.values)) {
        const types = fieldTypes.get(name);
        if (!types) throw new HttpError(422, `${where}.values.${name}: no such field on template`);
        for (const t of types) if (!PREFILLABLE_FIELD_TYPES.has(t)) throw new HttpError(422, `${where}.values.${name}: ${t} fields cannot be prefilled`);
      }
    }

    if (s.metadata !== undefined && (typeof s.metadata !== "object" || Array.isArray(s.metadata))) throw new HttpError(400, `${where}.metadata must be an object`);
    const meta: Json = { ...(s.metadata ?? {}) };
    if (Object.keys(meta).some((k) => k.startsWith("sb_"))) throw new HttpError(422, `${where}.metadata keys starting with sb_ are reserved`);
    meta.sb_origin = client.id;
    meta.sb_ref = ref;

    let ext = s.external_id !== undefined ? String(s.external_id) : `${ref}-${i}`;
    if (!ext.startsWith(client.external_id_prefix)) ext = client.external_id_prefix + ext;

    const out: Json = { ...s, metadata: meta, external_id: ext };
    if (client.force_email_2fa && s.email) out.require_email_2fa = true;
    if (!client.can_embed && s.send_email === false && s.send_sms !== true) {
      throw new HttpError(422, `${where}: signer links are not returned to this client, so DocuSeal must deliver them (send_email cannot be false)`);
    }
    return out;
  });

  if (!client.can_embed && b.send_email === false) throw new HttpError(422, "send_email cannot be false: signer links are not returned to this client");

  const payload: Json = { ...b, template_id: templateId, submitters, expire_at: new Date(expireAt).toISOString() };
  const created: Json[] = await ds("POST", "/submissions", { body: payload });
  const rows = Array.isArray(created) ? created : [created];
  return {
    sb_ref: ref,
    submission_id: rows[0]?.submission_id ?? null,
    expire_at: payload.expire_at,
    submitters: rows.map((r) => scrub(client, r)),
  };
}
