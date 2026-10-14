export class UpstreamError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`DocuSeal responded ${status}`);
  }
}

function base(): string {
  return (process.env.DOCUSEAL_API_BASE ?? "https://api.docuseal.com").replace(/\/+$/, "");
}

/** The only place the account API key is read. It is never echoed, logged, or returned. */
export async function ds<T = any>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<T> {
  const key = process.env.DOCUSEAL_API_KEY;
  if (!key) throw new Error("DOCUSEAL_API_KEY is not set");
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      "X-Auth-Token": key,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw new UpstreamError(res.status, parsed);
  return parsed as T;
}
