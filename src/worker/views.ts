import { progressRows, type DecisionLogRow, type TurnView } from "../core/api";
import type { TurnResult } from "../core/types";
import type { TutorDb } from "./db";
import { curriculum } from "./env";

// Response shapes, built in exactly one place. The view is also stored with
// the turn, so an idempotent retry returns precisely what was sent the first time.

export function turnView(seq: number, r: TurnResult): TurnView {
  const celebrateId = r.decision.celebrate?.misconceptionId;
  const celebrated = celebrateId ? curriculum.subconcepts.flatMap((s) => s.misconceptions).find((m) => m.id === celebrateId) : undefined;
  return {
    seq,
    speech: r.speech,
    board: r.board,
    decision: r.decision,
    assessment: r.assessment,
    progress: progressRows(curriculum, r.state),
    complete: r.state.subconceptId === null,
    degraded: r.telemetry.degraded,
    speechRate: r.speechRate,
    streak: r.state.streak,
    review: r.state.review !== null,
    celebrate: celebrated ? { misconceptionId: celebrated.id, label: celebrated.label } : null,
    timings: {
      totalMs: r.telemetry.totalMs,
      assessorMs: r.telemetry.calls.find((c) => c.role === "assessor")?.ms ?? null,
      responderMs: r.telemetry.calls.find((c) => c.role === "responder")?.ms ?? null,
    },
  };
}

export function decisionLogRows(rows: Awaited<ReturnType<TutorDb["decisionLog"]>>): DecisionLogRow[] {
  return rows.map((r) => ({
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
}

/** One structured line per turn → Workers Logs (see DESIGN.md, Observability). */
export function logTurn(sessionId: string, seq: number, r: TurnResult, clientTimings: unknown) {
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
