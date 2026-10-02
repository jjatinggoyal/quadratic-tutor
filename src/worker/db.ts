import type { HistoryLine } from "../core/prompts";
import type { SessionState, SubconceptProgress, TurnResult } from "../core/types";

// D1 persistence. All writes for one turn go in a single batch (a transaction),
// guarded by the UNIQUE(session_id, seq) constraint so two concurrent requests
// for the same session can't both apply.

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

export class ConflictError extends Error {}

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
        strategiesUsed: JSON.parse(r.strategies_used),
        misconceptions: JSON.parse(r.misconceptions),
        fixed: JSON.parse(r.fixed),
        reviewsPassed: r.reviews_passed,
        reviewsFailed: r.reviews_failed,
      };
      if (r.mastered_at && r.status === "mastered") masteredAt[r.subconcept_id] = r.mastered_at;
    }
    return { progress, masteredAt };
  }

  async createSession(id: string, studentId: string, state: SessionState, now: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE student_id = ?").bind(studentId).first<{ n: number }>();
    const sessionNumber = (row?.n ?? 0) + 1;
    await this.db
      .prepare(
        "INSERT INTO sessions (id, student_id, status, curriculum_id, curriculum_version, state_json, turn_count, session_number, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, 0, ?, ?, ?)",
      )
      .bind(id, studentId, state.curriculumId, state.curriculumVersion, JSON.stringify(state), sessionNumber, now, now)
      .run();
    return sessionNumber;
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

  async findTurnByClientId(sessionId: string, clientTurnId: string) {
    return this.db
      .prepare("SELECT seq, tutor_speech, action, reason, assessment_json, degraded, total_ms FROM turns WHERE session_id = ? AND client_turn_id = ?")
      .bind(sessionId, clientTurnId)
      .first<{ seq: number; tutor_speech: string; action: string; reason: string; assessment_json: string | null; degraded: number; total_ms: number }>();
  }

  async decisionLog(sessionId: string) {
    const { results } = await this.db
      .prepare("SELECT seq, created_at, student_text, subconcept_id, action, reason, correct, degraded, total_ms FROM turns WHERE session_id = ? ORDER BY seq")
      .bind(sessionId)
      .all<{ seq: number; created_at: number; student_text: string | null; subconcept_id: string | null; action: string; reason: string; correct: number | null; degraded: number; total_ms: number }>();
    return results;
  }

  /** Persist one turn atomically: turn row, session snapshot, and progress. */
  async saveTurn(args: {
    session: SessionRow;
    prevState: SessionState;
    result: TurnResult;
    studentText: string | null;
    inputSource: string | null;
    clientTurnId: string | null;
    clientTimings: unknown;
    now: number;
  }): Promise<number> {
    const { session, prevState, result, now } = args;
    const seq = session.turn_count + 1;
    const assessor = result.telemetry.calls.find((c) => c.role === "assessor");
    const responder = result.telemetry.calls.find((c) => c.role === "responder");
    const a = result.assessment;
    const d = result.decision;
    const s = result.state;

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO turns (id, session_id, seq, client_turn_id, created_at, student_text, input_source, subconcept_id, check_id,
             intent, correct, misconception_id, assessment_json, action, reason, next_subconcept_id, next_check_id, strategy_id,
             tutor_speech, board_ops_json, prompt_version, curriculum_version, assessor_model, responder_model,
             assessor_ms, responder_ms, total_ms, tokens_in, tokens_out, degraded, llm_attempts_json, client_timings_json,
             is_review, fixed_misconception)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(), session.id, seq, args.clientTurnId, now, args.studentText, args.inputSource,
          prevState.subconceptId, prevState.pendingCheckId,
          a?.intent ?? null, a?.correct === null || a?.correct === undefined ? null : a.correct ? 1 : 0, a?.misconceptionId ?? null,
          a ? JSON.stringify(a) : null,
          d.action, d.reason, s.subconceptId, s.pendingCheckId, d.strategyId,
          result.speech, JSON.stringify(result.boardOps), result.telemetry.promptVersion, s.curriculumVersion,
          assessor?.model ?? null, responder?.model ?? null, assessor?.ms ?? null, responder?.ms ?? null, result.telemetry.totalMs,
          sum(result, "tokensIn"), sum(result, "tokensOut"), result.telemetry.degraded ? 1 : 0,
          JSON.stringify(result.telemetry.calls.map((c) => ({ role: c.role, attempts: c.attempts }))),
          args.clientTimings ? JSON.stringify(args.clientTimings) : null,
          prevState.review && a?.intent === "answer" ? 1 : 0,
          d.celebrate?.misconceptionId ?? null,
        ),
      this.db
        .prepare("UPDATE sessions SET state_json = ?, turn_count = ?, status = ?, end_reason = ?, curriculum_version = ?, updated_at = ? WHERE id = ? AND turn_count = ?")
        .bind(JSON.stringify(s), seq, s.subconceptId ? "active" : "completed", s.subconceptId ? null : "finished", s.curriculumVersion, now, session.id, session.turn_count),
    ];

    for (const p of Object.values(s.progress)) {
      const before = prevState.progress[p.subconceptId];
      if (before && JSON.stringify(before) === JSON.stringify(p)) continue;
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO subconcept_progress (student_id, subconcept_id, status, checks_attempted, checks_correct, reteach_count, strategies_used,
               misconceptions, fixed, reviews_passed, reviews_failed, first_seen_at, mastered_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (student_id, subconcept_id) DO UPDATE SET
               status = excluded.status, checks_attempted = excluded.checks_attempted, checks_correct = excluded.checks_correct,
               reteach_count = excluded.reteach_count, strategies_used = excluded.strategies_used,
               misconceptions = excluded.misconceptions, fixed = excluded.fixed,
               reviews_passed = excluded.reviews_passed, reviews_failed = excluded.reviews_failed,
               -- latest mastery time; cleared if a retention check un-masters the topic
               mastered_at = CASE WHEN excluded.status = 'mastered' THEN COALESCE(subconcept_progress.mastered_at, excluded.mastered_at) ELSE NULL END,
               updated_at = excluded.updated_at`,
          )
          .bind(
            session.student_id, p.subconceptId, p.status, p.checksAttempted, p.checksCorrect, p.reteachCount, JSON.stringify(p.strategiesUsed),
            JSON.stringify(p.misconceptions), JSON.stringify(p.fixed), p.reviewsPassed, p.reviewsFailed,
            now, p.status === "mastered" ? now : null, now,
          ),
      );
    }

    try {
      await this.db.batch(stmts);
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new ConflictError("turn already applied for this session state");
      throw err;
    }
    return seq;
  }
}

function parseSession(row: RawSession): SessionRow {
  const { state_json, ...rest } = row;
  return { ...rest, state: JSON.parse(state_json) };
}

function sum(r: TurnResult, k: "tokensIn" | "tokensOut") {
  return r.telemetry.calls.reduce((acc, c) => acc + c[k], 0);
}
