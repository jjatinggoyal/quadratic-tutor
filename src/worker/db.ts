import type { TurnView } from "../core/api";
import type { HistoryLine } from "../core/prompts";
import type { SessionState, SubconceptProgress, TurnResult } from "../core/types";

// D1 persistence.
//
// A turn is committed as one batch (a transaction) in which every write is
// guarded by the session still being active and at the turn count we read:
//   1. INSERT the turn         … only if the session is active at turn_count N
//   2. UPSERT changed progress … only if that turn row now exists
//   3. UPDATE the session      … only if that turn row now exists
// If another request got there first, or the session was closed, statement 1
// inserts nothing and so does everything after it; we detect that from
// meta.changes and raise StaleSessionError. Nothing is half-applied.

export interface SessionRow {
  id: string;
  student_id: string;
  status: "active" | "completed";
  state: SessionState;
  turn_count: number;
  session_number: number;
  updated_at: number;
}

type RawSession = Omit<SessionRow, "state"> & { state_json: string };
const SESSION_COLS = "id, student_id, status, state_json, turn_count, session_number, updated_at";

/** The session moved on (another turn landed first) or was closed. */
export class StaleSessionError extends Error {}
/** The student already has an active session (a concurrent start won). */
export class ActiveSessionExistsError extends Error {}

export interface TurnRecord {
  session: SessionRow;
  prevState: SessionState;
  result: TurnResult;
  view: TurnView;
  studentText: string | null;
  inputSource: string | null;
  clientTurnId: string | null;
  clientTimings: unknown;
  now: number;
}

export class TutorDb {
  constructor(private db: D1Database) {}

  async ensureStudent(id: string, now: number, simulated = false) {
    await this.db.prepare("INSERT OR IGNORE INTO students (id, created_at, is_simulated) VALUES (?, ?, ?)").bind(id, now, simulated ? 1 : 0).run();
  }

  async latestActiveSession(studentId: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE student_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`)
      .bind(studentId)
      .first<RawSession>();
    return row ? parseSession(row) : null;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = await this.db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`).bind(id).first<RawSession>();
    return row ? parseSession(row) : null;
  }

  async closeSession(id: string, reason: "inactive" | "restarted", now: number) {
    await this.db.prepare("UPDATE sessions SET status = 'completed', end_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(reason, now, id).run();
  }

  /** Long-lived progress, plus when each topic was mastered (to pick the retention check). */
  async loadProgress(studentId: string): Promise<{ progress: Record<string, SubconceptProgress>; masteredAt: Record<string, number> }> {
    const { results } = await this.db
      .prepare(
        "SELECT subconcept_id, status, checks_attempted, checks_correct, reteach_count, strategies_used, misconceptions, fixed, reviews_passed, reviews_failed, mastered_at FROM subconcept_progress WHERE student_id = ?",
      )
      .bind(studentId)
      .all<{
        subconcept_id: string;
        status: SubconceptProgress["status"];
        checks_attempted: number;
        checks_correct: number;
        reteach_count: number;
        strategies_used: string;
        misconceptions: string;
        fixed: string;
        reviews_passed: number;
        reviews_failed: number;
        mastered_at: number | null;
      }>();
    const progress: Record<string, SubconceptProgress> = {};
    const masteredAt: Record<string, number> = {};
    for (const r of results) {
      progress[r.subconcept_id] = {
        subconceptId: r.subconcept_id,
        status: r.status,
        checksAttempted: r.checks_attempted,
        checksCorrect: r.checks_correct,
        reteachCount: r.reteach_count,
        strategiesUsed: parseJson(r.strategies_used, []),
        misconceptions: parseJson(r.misconceptions, {}),
        fixed: parseJson(r.fixed, []),
        reviewsPassed: r.reviews_passed,
        reviewsFailed: r.reviews_failed,
      };
      if (r.mastered_at && r.status === "mastered") masteredAt[r.subconcept_id] = r.mastered_at;
    }
    return { progress, masteredAt };
  }

  async recentHistory(sessionId: string, limit = 8): Promise<HistoryLine[]> {
    const { results } = await this.db
      .prepare("SELECT student_text, tutor_speech FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?")
      .bind(sessionId, limit)
      .all<{ student_text: string | null; tutor_speech: string }>();
    return results.reverse().flatMap((r): HistoryLine[] => [
      ...(r.student_text ? [{ role: "student" as const, text: r.student_text }] : []),
      { role: "tutor", text: r.tutor_speech },
    ]);
  }

  /** The stored response for a turn, for idempotent retries. null if unknown (or a row from before views were stored). */
  async findTurnView(sessionId: string, clientTurnId: string): Promise<TurnView | null> {
    const row = await this.db
      .prepare("SELECT view_json FROM turns WHERE session_id = ? AND client_turn_id = ?")
      .bind(sessionId, clientTurnId)
      .first<{ view_json: string | null }>();
    return row?.view_json ? parseJson<TurnView | null>(row.view_json, null) : null;
  }

  async decisionLog(sessionId: string) {
    const { results } = await this.db
      .prepare("SELECT seq, created_at, student_text, subconcept_id, action, reason, correct, degraded, total_ms FROM turns WHERE session_id = ? ORDER BY seq")
      .bind(sessionId)
      .all<{ seq: number; created_at: number; student_text: string | null; subconcept_id: string | null; action: string; reason: string; correct: number | null; degraded: number; total_ms: number }>();
    return results;
  }

  /**
   * Create a session together with its opening turn, atomically. The partial
   * unique index (one active session per student) makes a concurrent second
   * start fail with ActiveSessionExistsError instead of creating a duplicate.
   */
  async createSessionWithTurn(rec: TurnRecord): Promise<{ seq: number; sessionNumber: number }> {
    const { session, now } = rec;
    const insertSession = this.db
      .prepare(
        `INSERT INTO sessions (id, student_id, status, curriculum_id, curriculum_version, state_json, turn_count, session_number, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?, 0, (SELECT COUNT(*) + 1 FROM sessions WHERE student_id = ?), ?, ?)`,
      )
      .bind(session.id, session.student_id, session.state.curriculumId, session.state.curriculumVersion, JSON.stringify(session.state), session.student_id, now, now);
    try {
      await this.commit([insertSession], rec);
    } catch (err) {
      if (err instanceof StaleSessionError || /UNIQUE/.test(String(err))) throw new ActiveSessionExistsError();
      throw err;
    }
    const row = await this.db.prepare("SELECT session_number FROM sessions WHERE id = ?").bind(session.id).first<{ session_number: number }>();
    return { seq: 1, sessionNumber: row?.session_number ?? 1 };
  }

  /** Persist one turn: turn row, changed progress, session snapshot. See the header comment. */
  async saveTurn(rec: TurnRecord): Promise<number> {
    try {
      await this.commit([], rec);
    } catch (err) {
      // UNIQUE(session_id, seq) or (session_id, client_turn_id): a concurrent request won the race.
      if (/UNIQUE/.test(String(err))) throw new StaleSessionError();
      throw err;
    }
    return rec.session.turn_count + 1;
  }

  private async commit(before: D1PreparedStatement[], rec: TurnRecord) {
    const { session, prevState, result, now } = rec;
    const seq = session.turn_count + 1;
    const turnId = crypto.randomUUID();
    const s = result.state;
    const d = result.decision;
    const a = result.assessment;
    const assessor = result.telemetry.calls.find((c) => c.role === "assessor");
    const responder = result.telemetry.calls.find((c) => c.role === "responder");
    const tokens = (k: "tokensIn" | "tokensOut") => result.telemetry.calls.reduce((acc, c) => acc + c[k], 0);
    const turnExists = "EXISTS (SELECT 1 FROM turns WHERE id = ?)";

    const insertTurn = this.db
      .prepare(
        `INSERT INTO turns (id, session_id, seq, client_turn_id, created_at, student_text, input_source, subconcept_id, check_id,
           intent, correct, misconception_id, assessment_json, action, reason, next_subconcept_id, next_check_id, strategy_id,
           tutor_speech, board_ops_json, prompt_version, curriculum_version, assessor_model, responder_model,
           assessor_ms, responder_ms, total_ms, tokens_in, tokens_out, degraded, llm_attempts_json, client_timings_json,
           is_review, fixed_misconception, view_json)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
         WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ? AND turn_count = ? AND status = 'active')`,
      )
      .bind(
        turnId, session.id, seq, rec.clientTurnId, now, rec.studentText, rec.inputSource,
        prevState.subconceptId, prevState.pendingCheckId,
        a?.intent ?? null, a?.correct === null || a?.correct === undefined ? null : a.correct ? 1 : 0, a?.misconceptionId ?? null,
        a ? JSON.stringify(a) : null,
        d.action, d.reason, s.subconceptId, s.pendingCheckId, d.strategyId,
        result.speech, JSON.stringify(result.boardOps), result.telemetry.promptVersion, s.curriculumVersion,
        assessor?.model ?? null, responder?.model ?? null, assessor?.ms ?? null, responder?.ms ?? null, result.telemetry.totalMs,
        tokens("tokensIn"), tokens("tokensOut"), result.telemetry.degraded ? 1 : 0,
        JSON.stringify(result.telemetry.calls.map((c) => ({ role: c.role, attempts: c.attempts }))),
        rec.clientTimings ? JSON.stringify(rec.clientTimings) : null,
        prevState.review && a?.intent === "answer" ? 1 : 0,
        d.celebrate?.misconceptionId ?? null,
        JSON.stringify(rec.view),
        session.id, session.turn_count,
      );

    const upserts = Object.values(s.progress)
      .filter((p) => JSON.stringify(prevState.progress[p.subconceptId]) !== JSON.stringify(p))
      .map((p) =>
        this.db
          .prepare(
            `INSERT INTO subconcept_progress (student_id, subconcept_id, status, checks_attempted, checks_correct, reteach_count, strategies_used,
               misconceptions, fixed, reviews_passed, reviews_failed, first_seen_at, mastered_at, updated_at)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${turnExists}
             ON CONFLICT (student_id, subconcept_id) DO UPDATE SET
               status = excluded.status, checks_attempted = excluded.checks_attempted, checks_correct = excluded.checks_correct,
               reteach_count = excluded.reteach_count, strategies_used = excluded.strategies_used,
               misconceptions = excluded.misconceptions, fixed = excluded.fixed,
               reviews_passed = excluded.reviews_passed, reviews_failed = excluded.reviews_failed,
               -- first time mastered since it was last un-mastered; cleared if a retention check un-masters the topic
               mastered_at = CASE WHEN excluded.status = 'mastered' THEN COALESCE(subconcept_progress.mastered_at, excluded.mastered_at) ELSE NULL END,
               updated_at = excluded.updated_at`,
          )
          .bind(
            session.student_id, p.subconceptId, p.status, p.checksAttempted, p.checksCorrect, p.reteachCount, JSON.stringify(p.strategiesUsed),
            JSON.stringify(p.misconceptions), JSON.stringify(p.fixed), p.reviewsPassed, p.reviewsFailed,
            now, p.status === "mastered" ? now : null, now, turnId,
          ),
      );

    const updateSession = this.db
      .prepare(`UPDATE sessions SET state_json = ?, turn_count = ?, status = ?, end_reason = ?, curriculum_version = ?, updated_at = ? WHERE id = ? AND ${turnExists}`)
      .bind(JSON.stringify(s), seq, s.subconceptId ? "active" : "completed", s.subconceptId ? null : "finished", s.curriculumVersion, now, session.id, turnId);

    const results = await this.db.batch([...before, insertTurn, ...upserts, updateSession]);
    if ((results[before.length]?.meta.changes ?? 0) === 0) throw new StaleSessionError();
  }
}

function parseSession(row: RawSession): SessionRow {
  const { state_json, ...rest } = row;
  return { ...rest, state: JSON.parse(state_json) };
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
