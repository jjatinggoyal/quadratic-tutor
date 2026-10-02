import { z } from "zod";
import type { TurnView } from "../../core/api";
import { rebaseState, runTurn } from "../../core/engine";
import { StaleSessionError, type TutorDb } from "../db";
import { curriculum, engineDeps, type Env } from "../env";
import { HttpError, ID_RE, json, readBody } from "../http";
import { logTurn, turnView } from "../views";

const Body = z.object({
  sessionId: z.string().regex(ID_RE),
  clientTurnId: z.string().regex(ID_RE),
  text: z.string().trim().min(1).max(500),
  inputSource: z.enum(["browser_stt", "server_stt", "typed"]).catch("typed"),
  clientTimings: z.object({ sttMs: z.number().nonnegative().max(600_000).optional(), prevTtsMs: z.number().nonnegative().max(600_000).optional() }).strip().nullish(),
});

export async function turn(req: Request, env: Env, db: TutorDb): Promise<Response> {
  const body = await readBody(req, Body);
  const session = await db.getSession(body.sessionId);
  if (!session) throw new HttpError(404, "session not found");

  // Idempotent retry: the browser resends the same clientTurnId after a network error or timeout.
  const stored = await db.findTurnView(session.id, body.clientTurnId);
  if (stored) return json(stored);
  // A closed session (timed out, restarted elsewhere, finished) must not be revived by an old tab.
  if (session.status !== "active") throw new HttpError(409, "this session has ended; starting a new one", "session_closed");

  const prevState = rebaseState(session.state, curriculum);
  const result = await runTurn(engineDeps(env), prevState, await db.recentHistory(session.id), body.text);
  const seq = session.turn_count + 1;
  const view: TurnView = turnView(seq, result);
  try {
    await db.saveTurn({ session, prevState, result, view, studentText: body.text, inputSource: body.inputSource, clientTurnId: body.clientTurnId, clientTimings: body.clientTimings ?? null, now: Date.now() });
  } catch (err) {
    if (!(err instanceof StaleSessionError)) throw err;
    // Lost a race. If it was against our own earlier attempt (client timed out and retried), return that result.
    const won = await db.findTurnView(session.id, body.clientTurnId);
    if (won) return json(won);
    const now = await db.getSession(session.id);
    if (now?.status !== "active") throw new HttpError(409, "this session has ended; starting a new one", "session_closed");
    throw new HttpError(409, "another turn was applied to this session first; reload", "conflict");
  }
  logTurn(session.id, seq, result, body.clientTimings ?? null);
  return json(view);
}
