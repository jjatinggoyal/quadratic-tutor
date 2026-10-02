import { TutorDb } from "./db";
import { curriculum, sessionTimeoutMs, type Env } from "./env";
import { HttpError, json } from "./http";
import { computeInsights } from "./insights";
import { startSession } from "./routes/session";
import { speechToText } from "./routes/speech";
import { turn } from "./routes/turn";
import { decisionLogRows } from "./views";

export type { Env } from "./env";

// Router. Static assets (the SPA) are served by the assets binding; /api/* comes here.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      console.error(JSON.stringify({ event: "unhandled_error", path: url.pathname, error: String(err), stack: (err as Error)?.stack }));
      return json({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const db = new TutorDb(env.DB);
  const p = url.pathname;
  const is = (method: string, path: string) => req.method === method && p === path;

  if (p === "/api/health") return json({ ok: true, curriculumVersion: curriculum.version });
  if (is("GET", "/api/curriculum")) return json({ id: curriculum.id, version: curriculum.version, subconcepts: curriculum.subconcepts.map((s) => ({ id: s.id, title: s.title })) });
  if (is("POST", "/api/session")) return startSession(req, env, db);
  if (is("POST", "/api/turn")) return turn(req, env, db);
  if (is("POST", "/api/stt")) return speechToText(req, env);
  if (is("GET", "/api/insights")) {
    const sim = url.searchParams.get("sim");
    return json(await computeInsights(env.DB, curriculum, sim === "include" || sim === "only" ? sim : "exclude", sessionTimeoutMs(env)));
  }
  const log = p.match(/^\/api\/session\/([\w-]{8,64})\/log$/);
  if (log && req.method === "GET") return json(decisionLogRows(await db.decisionLog(log[1])));
  throw new HttpError(404, "not_found");
}
