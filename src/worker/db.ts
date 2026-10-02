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
}

export class ConflictError extends Error {}

export class TutorDb {
  constructor(private db: D1Database) {}

  async ensureStudent(id: string, now: number) {
    await this.db.prepare("INSERT OR IGNORE INTO students (id, created_at) VALUES (?, ?)").bind(id, now).run();
  }

  async latestActiveSession(studentId: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT id, student_id, status, state_json, turn_count FROM sessions WHERE student_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1")
      .bind(studentId)
      .first<{ id: string; student_id: string; status: "active"; state_json: string; turn_count: number }>();
    return row ? { ...row, state: JSON.parse(row.state_json) } : null;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT id, student_id, status, state_json, turn_count FROM sessions WHERE id = ?")
      .bind(id)
      .first<{ id: string; student_id: string; status: "active" | "completed"; state_json: string; turn_count: number }>();
    return row ? { ...row, state: JSON.parse(row.state_json) } : null;
  }

  async loadProgress(studentId: string): Promise<Record<string, SubconceptProgress>> {
    const { results } = await this.db
      .prepare("SELECT subconcept_id, status, checks_attempted, checks_correct, reteach_count, strategies_used FROM subconcept_progress WHERE student_id = ?")
      .bind(studentId)
      .all<{ subconcept_id: string; status: SubconceptProgress["status"]; checks_attempted: number; checks_correct: number; reteach_count: number; strategies_used: string }>();
    return Object.fromEntries(
      results.map((r) => [
        r.subconcept_id,
        {
          subconceptId: r.subconcept_id,
          status: r.status,
          checksAttempted: r.checks_attempted,
          checksCorrect: r.checks_correct,
          reteachCount: r.reteach_count,
          strategiesUsed: JSON.parse(r.strategies_used),
        },
      ]),
    );
  }

  async createSession(id: string, studentId: string, state: SessionState, now: number) {
    await this.db
      .prepare("INSERT INTO sessions (id, student_id, status, curriculum_id, curriculum_version, state_json, turn_count, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, 0, ?, ?)")
      .bind(id, studentId, state.curriculumId, state.curriculumVersion, JSON.stringify(state), now, now)
      .run();
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
             assessor_ms, responder_ms, total_ms, tokens_in, tokens_out, degraded, llm_attempts_json, client_timings_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        ),
      this.db
        .prepare("UPDATE sessions SET state_json = ?, turn_count = ?, status = ?, curriculum_version = ?, updated_at = ? WHERE id = ? AND turn_count = ?")
        .bind(JSON.stringify(s), seq, s.subconceptId ? "active" : "completed", s.curriculumVersion, now, session.id, session.turn_count),
    ];

    for (const p of Object.values(s.progress)) {
      const before = prevState.progress[p.subconceptId];
      if (before && JSON.stringify(before) === JSON.stringify(p)) continue;
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO subconcept_progress (student_id, subconcept_id, status, checks_attempted, checks_correct, reteach_count, strategies_used, first_seen_at, mastered_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (student_id, subconcept_id) DO UPDATE SET
               status = excluded.status, checks_attempted = excluded.checks_attempted, checks_correct = excluded.checks_correct,
               reteach_count = excluded.reteach_count, strategies_used = excluded.strategies_used,
               mastered_at = COALESCE(subconcept_progress.mastered_at, excluded.mastered_at), updated_at = excluded.updated_at`,
          )
          .bind(session.student_id, p.subconceptId, p.status, p.checksAttempted, p.checksCorrect, p.reteachCount, JSON.stringify(p.strategiesUsed), now, p.status === "mastered" ? now : null, now),
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

function sum(r: TurnResult, k: "tokensIn" | "tokensOut") {
  return r.telemetry.calls.reduce((acc, c) => acc + c[k], 0);
}
