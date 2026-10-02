import { progressRows, type DecisionLogRow, type SessionResponse, type TurnRequest, type TurnView } from "../core/api";
import { quadratics } from "../core/curriculum/quadratics";
import { openingTurn, rebaseState, runTurn, stateFromProgress, type EngineDeps } from "../core/engine";
import { OpenRouterTransport } from "../core/llm";
import type { TurnResult } from "../core/types";
import { ConflictError, TutorDb, type SessionRow } from "./db";
import { transcribe } from "./stt";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_KEY: string;
  MODEL_ASSESSOR: string;
  MODEL_RESPONDER: string;
  MODEL_FALLBACK: string;
  MODEL_STT: string;
  MODEL_STT_FALLBACK: string;
}

const curriculum = quadratics;
const MAX_TEXT = 500;
const MAX_AUDIO_BYTES = 2_000_000; // ~60 s of 16 kHz mono WAV

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(JSON.stringify({ event: "unhandled_error", path: url.pathname, error: String(err), stack: (err as Error)?.stack }));
      return json({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const db = new TutorDb(env.DB);
  const p = url.pathname;

  if (p === "/api/health") return json({ ok: true, curriculumVersion: curriculum.version });
  if (p === "/api/curriculum" && req.method === "GET") {
    return json({ id: curriculum.id, version: curriculum.version, subconcepts: curriculum.subconcepts.map((s) => ({ id: s.id, title: s.title })) });
  }
  if (p === "/api/session" && req.method === "POST") return startSession(req, env, db);
  if (p === "/api/turn" && req.method === "POST") return turn(req, env, db);
  if (p === "/api/stt" && req.method === "POST") return stt(req, env);
  const log = p.match(/^\/api\/session\/([\w-]+)\/log$/);
  if (log && req.method === "GET") {
    const rows = await db.decisionLog(log[1]);
    const out: DecisionLogRow[] = rows.map((r) => ({
      seq: r.seq,
      createdAt: r.created_at,
      studentText: r.student_text,
      subconceptId: r.subconcept_id,
      action: r.action,
      reason: r.reason,
      correct: r.correct === null ? null : r.correct === 1,
      degraded: r.degraded === 1,
      totalMs: r.total_ms,
    }));
    return json(out);
  }
  throw new HttpError(404, "not_found");
}

function deps(env: Env): EngineDeps {
  if (!env.OPENROUTER_KEY) throw new HttpError(500, "server misconfigured: OPENROUTER_KEY missing");
  return {
    curriculum,
    transport: new OpenRouterTransport(env.OPENROUTER_KEY),
    models: { assessor: env.MODEL_ASSESSOR, responder: env.MODEL_RESPONDER, fallback: env.MODEL_FALLBACK },
  };
}

// ---------------------------------------------------------------------------

async function startSession(req: Request, env: Env, db: TutorDb): Promise<Response> {
  const body = await readJson<{ studentId?: string; forceNew?: boolean }>(req);
  const now = Date.now();
  const studentId = validId(body.studentId) ?? crypto.randomUUID();
  await db.ensureStudent(studentId, now);

  let session = body.forceNew ? null : await db.latestActiveSession(studentId);
  const resumed = !!session;
  if (!session) {
    const state = stateFromProgress(curriculum, await db.loadProgress(studentId));
    const id = crypto.randomUUID();
    await db.createSession(id, studentId, state, now);
    session = { id, student_id: studentId, status: "active", state, turn_count: 0 };
  }

  const state = rebaseState(session.state, curriculum);
  const history = await db.recentHistory(session.id);
  const result = await openingTurn(deps(env), state, history);

  let seq = session.turn_count;
  if (!resumed) {
    // The opening lesson is a real turn: it is logged and becomes history.
    seq = await db.saveTurn({ session, prevState: state, result, studentText: null, inputSource: null, clientTurnId: null, clientTimings: null, now });
  }
  logTurn(session.id, seq, result, null);
  const out: SessionResponse = { studentId, sessionId: session.id, resumed, turn: view(seq, result) };
  return json(out);
}

async function turn(req: Request, env: Env, db: TutorDb): Promise<Response> {
  const body = await readJson<TurnRequest>(req);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) throw new HttpError(400, "text is required");
  const clientTurnId = validId(body.clientTurnId);
  if (!clientTurnId) throw new HttpError(400, "clientTurnId is required");
  const inputSource = ["browser_stt", "server_stt", "typed"].includes(body.inputSource) ? body.inputSource : "typed";

  const session = await db.getSession(body.sessionId);
  if (!session) throw new HttpError(404, "session not found");

  // Idempotent retry: the browser resends the same clientTurnId after a network error.
  const existing = await db.findTurnByClientId(session.id, clientTurnId);
  if (existing) return json(replayView(existing, session));

  const prevState = rebaseState(session.state, curriculum);
  const history = await db.recentHistory(session.id);
  const result = await runTurn(deps(env), prevState, history, text);
  const now = Date.now();

  let seq: number;
  try {
    seq = await db.saveTurn({ session, prevState, result, studentText: text, inputSource, clientTurnId, clientTimings: body.clientTimings ?? null, now });
  } catch (err) {
    if (err instanceof ConflictError) throw new HttpError(409, "another turn was applied to this session first; reload");
    throw err;
  }
  logTurn(session.id, seq, result, body.clientTimings ?? null);
  return json(view(seq, result));
}

async function stt(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ audio?: string }>(req);
  if (typeof body.audio !== "string" || !body.audio) throw new HttpError(400, "audio (base64 wav) is required");
  if (body.audio.length * 0.75 > MAX_AUDIO_BYTES) throw new HttpError(413, "audio too long");
  const out = await transcribe(new OpenRouterTransport(env.OPENROUTER_KEY), [env.MODEL_STT, env.MODEL_STT_FALLBACK], body.audio);
  console.log(JSON.stringify({ event: "stt", ok: out.text !== null, ms: out.ms, attempts: out.attempts }));
  if (out.text === null) throw new HttpError(503, "transcription unavailable; please type your answer");
  return json({ text: out.text, ms: out.ms });
}

// ---------------------------------------------------------------------------

function view(seq: number, r: TurnResult): TurnView {
  return {
    seq,
    speech: r.speech,
    board: r.board,
    decision: r.decision,
    assessment: r.assessment,
    progress: progressRows(curriculum, r.state),
    complete: r.state.subconceptId === null,
    degraded: r.telemetry.degraded,
    timings: {
      totalMs: r.telemetry.totalMs,
      assessorMs: r.telemetry.calls.find((c) => c.role === "assessor")?.ms ?? null,
      responderMs: r.telemetry.calls.find((c) => c.role === "responder")?.ms ?? null,
    },
  };
}

function replayView(t: NonNullable<Awaited<ReturnType<TutorDb["findTurnByClientId"]>>>, session: SessionRow): TurnView {
  const state = session.state;
  return {
    seq: t.seq,
    speech: t.tutor_speech,
    board: state.board,
    decision: {
      action: t.action as TurnView["decision"]["action"],
      reason: t.reason,
      fromSubconceptId: null,
      toSubconceptId: state.subconceptId,
      strategyId: null,
      checkId: state.pendingCheckId,
    },
    assessment: t.assessment_json ? JSON.parse(t.assessment_json) : null,
    progress: progressRows(curriculum, state),
    complete: state.subconceptId === null,
    degraded: t.degraded === 1,
    timings: { totalMs: t.total_ms, assessorMs: null, responderMs: null },
  };
}

/** One structured line per turn → Workers Logs (see DESIGN.md, Observability). */
function logTurn(sessionId: string, seq: number, r: TurnResult, clientTimings: unknown) {
  console.log(
    JSON.stringify({
      event: "turn",
      sessionId,
      seq,
      action: r.decision.action,
      subconcept: r.decision.fromSubconceptId,
      intent: r.assessment?.intent ?? null,
      correct: r.assessment?.correct ?? null,
      assessmentSource: r.assessment?.source ?? null,
      degraded: r.telemetry.degraded,
      promptVersion: r.telemetry.promptVersion,
      totalMs: r.telemetry.totalMs,
      calls: r.telemetry.calls.map((c) => ({ role: c.role, model: c.model, ms: c.ms, tokensIn: c.tokensIn, tokensOut: c.tokensOut, attempts: c.attempts })),
      clientTimings,
    }),
  );
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function validId(v: unknown): string | null {
  return typeof v === "string" && /^[\w-]{8,64}$/.test(v) ? v : null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
