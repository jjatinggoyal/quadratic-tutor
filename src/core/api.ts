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
  timings: { totalMs: number; assessorMs: number | null; responderMs: number | null };
}

export interface SessionResponse {
  studentId: string;
  sessionId: string;
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
    };
  });
}
