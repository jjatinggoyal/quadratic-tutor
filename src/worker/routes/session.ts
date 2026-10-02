import { z } from "zod";
import type { SessionResponse } from "../../core/api";
import { openingTurn, rebaseState, stateFromProgress } from "../../core/engine";
import { startReview } from "../../core/policy";
import { ActiveSessionExistsError, TutorDb, type SessionRow } from "../db";
import { curriculum, engineDeps, sessionTimeoutMs, type Env } from "../env";
import { ID_RE, json, readBody } from "../http";
import { logTurn, turnView } from "../views";

const Body = z.object({
  studentId: z.string().regex(ID_RE).nullish(),
  forceNew: z.boolean().optional(),
  simulated: z.boolean().optional(),
});

/**
 * Start or resume a session. A session is one sitting: after inactivity the
 * next visit starts session N+1 from saved progress, opening with a retention
 * check on the most recently mastered topic.
 */
export async function startSession(req: Request, env: Env, db: TutorDb): Promise<Response> {
  const body = await readBody(req, Body);
  const now = Date.now();
  const studentId = body.studentId ?? crypto.randomUUID();
  await db.ensureStudent(studentId, now, body.simulated === true);

  let session = await db.latestActiveSession(studentId);
  if (session && (body.forceNew || now - session.updated_at > sessionTimeoutMs(env))) {
    await db.closeSession(session.id, body.forceNew ? "restarted" : "inactive", now);
    session = null;
  }
  if (session) return resume(env, db, studentId, session);

  const { progress, masteredAt } = await db.loadProgress(studentId);
  let state = stateFromProgress(curriculum, progress);
  const lastMastered = Object.entries(masteredAt).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (lastMastered) state = startReview(curriculum, state, lastMastered);

  const fresh: SessionRow = { id: crypto.randomUUID(), student_id: studentId, status: "active", state, turn_count: 0, session_number: 0, updated_at: now };
  const result = await openingTurn(engineDeps(env), state, []);
  const view = turnView(1, result);
  try {
    // The opening turn is a real turn (logged, part of history), saved atomically with the session.
    const { sessionNumber } = await db.createSessionWithTurn({ session: fresh, prevState: state, result, view, studentText: null, inputSource: null, clientTurnId: null, clientTimings: null, now });
    logTurn(fresh.id, 1, result, null);
    return json({ studentId, sessionId: fresh.id, sessionNumber, resumed: false, turn: view } satisfies SessionResponse);
  } catch (err) {
    // A concurrent request (another tab, a retry) created the session first: resume that one.
    if (!(err instanceof ActiveSessionExistsError)) throw err;
    const winner = await db.latestActiveSession(studentId);
    if (!winner) throw err;
    return resume(env, db, studentId, winner);
  }
}

async function resume(env: Env, db: TutorDb, studentId: string, session: SessionRow): Promise<Response> {
  const state = rebaseState(session.state, curriculum);
  const result = await openingTurn(engineDeps(env), state, await db.recentHistory(session.id));
  const out: SessionResponse = { studentId, sessionId: session.id, sessionNumber: session.session_number, resumed: true, turn: turnView(session.turn_count, result) };
  return json(out);
}
