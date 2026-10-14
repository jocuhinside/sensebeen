import { NextResponse, type NextRequest } from "next/server";
import { UpstreamError } from "@/lib/docuseal";
import {
  HttpError,
  createSubmission,
  getSubmission,
  getSubmissionDocuments,
  getTemplate,
  listSubmissions,
  listTemplates,
} from "@/lib/handlers";
import { authenticate, type Client } from "@/lib/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000;

function log(client: Client | null, method: string, path: string, status: number, extra: Record<string, unknown> = {}) {
  // one structured line per call; lands in the deployment's runtime logs
  console.log(JSON.stringify({ at: new Date().toISOString(), svc: "esign-proxy", client: client?.id ?? null, method, path, status, ...extra }));
}

function id(seg: string | undefined): number {
  const n = Number(seg);
  if (!seg || !Number.isInteger(n) || n <= 0) throw new HttpError(404, "not found");
  return n;
}

async function handle(req: NextRequest, segs: string[]) {
  const method = req.method;
  const path = "/" + segs.join("/");
  const client = authenticate(req.headers.get("authorization"));
  if (!client) {
    log(null, method, path, 401);
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  try {
    let result: unknown;
    const [a, b, c] = segs;
    if (method === "GET" && a === "whoami" && !b) {
      result = {
        client: client.id,
        templates: client.templates,
        external_id_prefix: client.external_id_prefix,
        can_download: client.can_download,
        can_embed: client.can_embed,
        max_expire_days: client.max_expire_days,
        force_email_2fa: client.force_email_2fa,
        allowed_email_domains: client.allowed_email_domains,
      };
    } else if (method === "GET" && a === "templates" && !b) {
      result = await listTemplates(client);
    } else if (method === "GET" && a === "templates" && b && !c) {
      result = await getTemplate(client, id(b));
    } else if (method === "GET" && a === "submissions" && !b) {
      result = await listSubmissions(client, req.nextUrl.searchParams);
    } else if (method === "GET" && a === "submissions" && b && !c) {
      result = await getSubmission(client, id(b));
    } else if (method === "GET" && a === "submissions" && b && c === "documents" && segs.length === 3) {
      result = await getSubmissionDocuments(client, id(b), req.nextUrl.searchParams.get("merge") === "true");
    } else if (method === "POST" && a === "submissions" && !b) {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_BODY) throw new HttpError(413, "body too large");
      const text = await req.text();
      if (text.length > MAX_BODY) throw new HttpError(413, "body too large");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, "invalid JSON");
      }
      const out = await createSubmission(client, body);
      log(client, method, path, 201, { submission_id: (out as any).submission_id, sb_ref: (out as any).sb_ref });
      return NextResponse.json(out, { status: 201 });
    } else {
      // archive, delete, template mutation, and anything unlisted are deliberately absent
      throw new HttpError(405, "not supported by this proxy");
    }
    log(client, method, path, 200);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof HttpError) {
      log(client, method, path, e.status, { error: e.message });
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof UpstreamError) {
      const status = e.status >= 500 ? 502 : e.status;
      const msg = typeof e.body === "object" && e.body && "error" in (e.body as any) ? String((e.body as any).error) : "upstream rejected the request";
      log(client, method, path, status, { upstream: e.status });
      return NextResponse.json({ error: msg }, { status });
    }
    log(client, method, path, 500, { error: String((e as Error)?.message ?? e) });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, (await ctx.params).path);
}
