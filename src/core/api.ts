import type { Assessment, BoardItem, Curriculum, Decision, SessionState, SubconceptStatus } from "./types";

// Wire types shared by the Worker and the browser.

export type InputSource = "browser_stt" | "server_stt" | "typed";

export interface ProgressRow {
  id: string;
  title: string;
  status: SubconceptStatus;
  checksAttempted: number;
  checksCorrect: number;
  reteachCount: number;
  current: boolean;
  /** Mistakes made in this topic, most frequent first. */
  mistakes: { id: string; label: string; count: number; fixed: boolean }[];
  reviewsPassed: number;
  reviewsFailed: number;
}

export interface TurnView {
  seq: number;
  speech: string;
  board: BoardItem[];
  decision: Decision;
  assessment: Assessment | null;
  progress: ProgressRow[];
  complete: boolean;
  degraded: boolean;
  /** TTS rate to use; below 1 when the student asked for slower. */
  speechRate: number;
  /** Correct answers in a row, across topics. */
  streak: number;
  /** True while a retention ("warm-up") question is pending. */
  review: boolean;
  /** Set when the student just overcame a mistake they made earlier. */
  celebrate: { misconceptionId: string; label: string } | null;
  timings: { totalMs: number; assessorMs: number | null; responderMs: number | null };
}

export interface SessionResponse {
  studentId: string;
  sessionId: string;
  sessionNumber: number;
  resumed: boolean;
  turn: TurnView;
}

export interface TurnRequest {
  sessionId: string;
  clientTurnId: string;
  text: string;
  inputSource: InputSource;
  clientTimings?: { sttMs?: number; prevTtsMs?: number };
}

export interface DecisionLogRow {
  seq: number;
  createdAt: number;
  studentText: string | null;
  subconceptId: string | null;
  action: string;
  reason: string;
  correct: boolean | null;
  degraded: boolean;
  totalMs: number;
}

export function progressRows(c: Curriculum, state: SessionState): ProgressRow[] {
  return c.subconcepts.map((s) => {
    const p = state.progress[s.id];
    return {
      id: s.id,
      title: s.title,
      status: p?.status ?? "not_started",
      checksAttempted: p?.checksAttempted ?? 0,
      checksCorrect: p?.checksCorrect ?? 0,
      reteachCount: p?.reteachCount ?? 0,
      current: state.subconceptId === s.id,
      mistakes: Object.entries(p?.misconceptions ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, label: s.misconceptions.find((m) => m.id === id)?.label ?? id, count, fixed: p?.fixed?.includes(id) ?? false })),
      reviewsPassed: p?.reviewsPassed ?? 0,
      reviewsFailed: p?.reviewsFailed ?? 0,
    };
  });
}

// ---------- Insights (/insights) ----------

export type SimFilter = "exclude" | "include" | "only";

export interface Insights {
  sim: SimFilter;
  generatedAt: number;
  overview: { students: number; sessions: number; turns: number; finishedSessions: number; returningStudents: number; turnsPerSession: number };
  /** P(next answer correct | re-teach), across all strategies. The headline metric (DESIGN.md §5). */
  reteachSuccessOverall: number | null;
  funnel: { id: string; title: string; mastered: number; inProgress: number; needsReview: number }[];
  reteach: { subconcept: string; strategy: string; n: number; success: number | null }[];
  misconceptions: { subconcept: string; label: string; seen: number; fixed: number }[];
  hardestChecks: { subconcept: string; question: string; answers: number; accuracy: number | null; unclearRate: number }[];
  intents: { intent: string; n: number; share: number }[];
  actions: { action: string; n: number }[];
  latency: { p50: number | null; p90: number | null; assessorP50: number | null; responderP50: number | null; degradedRate: number; sample: number };
  versions: { promptVersion: string; responderModel: string | null; turns: number; degradedRate: number; reteachRate: number; accuracy: number | null }[];
  dropoff: { subconcept: string; action: string; n: number }[];
  retention: { subconcept: string; passed: number; failed: number }[];
  inputSources: { source: string; n: number }[];
}
