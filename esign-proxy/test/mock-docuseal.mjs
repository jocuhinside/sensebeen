// Minimal stand-in for api.docuseal.com, shaped from the public API docs. Test use only.
import http from "node:http";

const KEY = "master-key-test";
const templates = {
  101: {
    id: 101, name: "Njoya Test NDA", external_id: null,
    submitters: [{ name: "Engineer", uuid: "r1" }, { name: "SenseBeen", uuid: "r2" }],
    fields: [
      { name: "Full Name", type: "text", submitter_uuid: "r1", required: true },
      { name: "Signature", type: "signature", submitter_uuid: "r1", required: true },
      { name: "Date", type: "date", submitter_uuid: "r1", required: true },
      { name: "SB Signature", type: "signature", submitter_uuid: "r2", required: true },
    ],
  },
  102: { id: 102, name: "Interop Test Record", submitters: [{ name: "Tester", uuid: "t1" }], fields: [{ name: "Result", type: "text", submitter_uuid: "t1" }] },
  999: { id: 999, name: "CIPV-2026-001 Assignment (NOT allowlisted)", submitters: [{ name: "Assignor", uuid: "a1" }], fields: [] },
};
const submissions = {
  // pre-existing submission on an allowlisted template, created by the operator, not by the client
  500: { id: 500, template: { id: 101, name: "Njoya Test NDA" }, status: "pending", created_by_user: { email: "op@x" }, slug: "s500",
    submitters: [{ id: 1, email: "someone@else.com", metadata: {}, slug: "x", embed_src: "https://docuseal/s/x" }] },
  501: { id: 501, template: { id: 999 }, status: "completed", submitters: [{ id: 2, email: "giles@njoya", metadata: { sb_origin: "giles" } }] },
};
let nextSub = 600, nextSubmitter = 10;
export const calls = [];

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const ch of req) body += ch;
  const u = new URL(req.url, "http://x");
  calls.push({ method: req.method, path: u.pathname, body: body ? JSON.parse(body) : null });
  if (u.pathname === "/__calls") return send(res, 200, calls);
  if (req.headers["x-auth-token"] !== KEY) return send(res, 401, { error: "Not authenticated" });
  let m;
  if (req.method === "GET" && (m = u.pathname.match(/^\/templates\/(\d+)$/))) {
    const t = templates[m[1]];
    return t ? send(res, 200, t) : send(res, 404, { error: "Not found" });
  }
  if (req.method === "GET" && u.pathname === "/submissions") {
    const tid = Number(u.searchParams.get("template_id"));
    // list rows deliberately omit submitter metadata to exercise the detail fallback
    const data = Object.values(submissions).filter((s) => s.template.id === tid)
      .map((s) => ({ id: s.id, status: s.status, submitters: s.submitters.map(({ metadata, ...r }) => r) }));
    return send(res, 200, { data, pagination: {} });
  }
  if (req.method === "GET" && (m = u.pathname.match(/^\/submissions\/(\d+)$/))) {
    const s = submissions[m[1]];
    return s ? send(res, 200, s) : send(res, 404, { error: "Not found" });
  }
  if (req.method === "GET" && (m = u.pathname.match(/^\/submissions\/(\d+)\/documents$/))) {
    return send(res, 200, { id: Number(m[1]), documents: [{ name: "doc", url: "https://blob/doc.pdf" }] });
  }
  if (req.method === "POST" && u.pathname === "/submissions") {
    const b = JSON.parse(body);
    const id = nextSub++;
    const rows = b.submitters.map((s) => ({ id: nextSubmitter++, submission_id: id, email: s.email, role: s.role, external_id: s.external_id,
      metadata: s.metadata, status: "sent", slug: "slug" + id, embed_src: "https://docuseal/s/slug" + id }));
    submissions[id] = { id, template: { id: b.template_id }, status: "pending", expire_at: b.expire_at, created_by_user: { email: "op@x" }, submitters: rows };
    return send(res, 200, rows);
  }
  return send(res, 404, { error: "Not found" });
});
server.listen(Number(process.env.MOCK_PORT ?? 3199), () => console.log("mock docuseal up"));
