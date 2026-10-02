import type { z } from "zod";

// HTTP helpers shared by the route handlers.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason the client can act on, e.g. "session_closed". */
    public code?: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 3_000_000; // audio uploads are the largest legitimate body

/** Parse and validate a JSON body. Requires application/json, which also stops cross-site "simple" POSTs. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "expected application/json");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

export const ID_RE = /^[\w-]{8,64}$/;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
