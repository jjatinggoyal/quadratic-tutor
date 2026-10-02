import { applyBoardOps, QUESTION_IDS } from "../src/core/board";
import { quadratics } from "../src/core/curriculum/quadratics";
import type { CompletionRequest, CompletionResponse, LlmTransport } from "../src/core/llm";
import { stateFromProgress } from "../src/core/policy";
import type { BoardOp, SessionState, SubconceptProgress } from "../src/core/types";

/**
 * Build a session state positioned at a given subconcept and pending check, as
 * if the student had got there naturally: earlier topics mastered, the topic
 * title and question on the board.
 */
export function stateAt(
  subconceptId: string,
  checkId: string,
  o: { strategyIndex?: number; reteachesHere?: number; correctInARow?: number } = {},
): SessionState {
  const c = quadratics;
  const idx = c.subconcepts.findIndex((s) => s.id === subconceptId);
  if (idx < 0) throw new Error(`unknown subconcept ${subconceptId}`);
  const progress: Record<string, SubconceptProgress> = {};
  for (const s of c.subconcepts.slice(0, idx)) {
    progress[s.id] = { subconceptId: s.id, status: "mastered", checksAttempted: 2, checksCorrect: 2, reteachCount: 0, strategiesUsed: [s.strategies[0].id] };
  }
  const base = stateFromProgress(c, progress);
  const sub = c.subconcepts[idx];
  const check = sub.checks.find((q) => q.id === checkId);
  if (!check) throw new Error(`unknown check ${checkId} in ${subconceptId}`);

  const ops: BoardOp[] = [
    { op: "write", id: "title", kind: "text", content: sub.title },
    { op: "write", id: QUESTION_IDS.text, kind: "text", content: `Your turn: ${check.text}` },
  ];
  if (check.math) ops.push({ op: "write", id: QUESTION_IDS.math, kind: "math", content: check.math });

  return {
    ...base,
    subconceptId,
    pendingCheckId: checkId,
    usedCheckIds: sub.checks.slice(0, sub.checks.indexOf(check) + 1).map((q) => q.id),
    strategyIndex: o.strategyIndex ?? 0,
    reteachesHere: o.reteachesHere ?? 0,
    correctInARow: o.correctInARow ?? 0,
    board: applyBoardOps([], ops).board,
    progress: {
      ...base.progress,
      [subconceptId]: { ...base.progress[subconceptId], status: "in_progress", reteachCount: o.reteachesHere ?? 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Fault-injecting transports for the resilience scenarios. No network.

/** Never answers; only the caller's timeout ends the request. */
export const hangingTransport: LlmTransport = {
  complete: (req: CompletionRequest) =>
    new Promise<CompletionResponse>((_, reject) => {
      req.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
};

/** Answers instantly with text that isn't the JSON we asked for. */
export const garbageTransport: LlmTransport = {
  complete: async () => ({ text: "Sure! Here's a great explanation of quadratics: {not json", tokensIn: 10, tokensOut: 10 }),
};

/** Fails for the listed models with HTTP 503, delegates the rest. */
export function outageTransport(downModels: string[], rest: LlmTransport): LlmTransport {
  return {
    complete: async (req) => {
      if (downModels.includes(req.model)) throw new Error("http_503: provider unavailable");
      return rest.complete(req);
    },
  };
}

/** Returns a fixed JSON reply chosen by which role is asking (detected from the system prompt). */
export function scriptedTransport(replies: { assessor: unknown; responder: unknown }): LlmTransport {
  return {
    complete: async (req) => {
      const system = typeof req.messages[0].content === "string" ? req.messages[0].content : "";
      const reply = system.includes("assessment module") ? replies.assessor : replies.responder;
      return { text: JSON.stringify(reply), tokensIn: 0, tokensOut: 0 };
    },
  };
}
