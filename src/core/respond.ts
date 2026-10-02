import { applyBoardOps, isWhy, QUESTION_IDS } from "./board";
import { cannedResponse, type ResponderReply } from "./canned";
import { leakProblem, writtenLines } from "./leak";
import { callJson, modelChain } from "./llm";
import { getCheck, getSubconcept } from "./policy";
import { PROMPT_VERSION, responderMessages, type HistoryLine, type ResponderContext } from "./prompts";
import { ResponderOutput } from "./schemas";
import type { Assessment, BoardItem, BoardOp, CheckItem, Curriculum, Decision, LlmCallTelemetry, SessionState, Subconcept, TurnResult, TutorAction } from "./types";
import type { EngineDeps } from "./engine";

// The "respond" half of a turn: given a decision that is already made, compose
// the board, ask the responder LLM for speech (and board ops), add the
// "why that's right" block, and append the next question.

export interface RespondArgs {
  prevState: SessionState;
  nextState: SessionState;
  decision: Decision;
  assessment: Assessment | null;
  studentText: string | null;
  history: HistoryLine[];
  calls: LlmCallTelemetry[];
  started: number;
}

/** Lines only the system writes; the LLM may highlight them but not overwrite them. */
const RESERVED_IDS = new Set<string>([QUESTION_IDS.text, QUESTION_IDS.math, "title"]);
/** Actions that start a fresh board for a (new) topic. */
const NEW_TOPIC_ACTIONS = new Set<TutorAction>(["teach", "advance", "move_on_flagged", "complete", "review"]);
/** How many past decisions the tutor remembers (and can explain). */
const MEMORY = 4;
const RESPONDER_TIMEOUTS = { responderMs: 9000, responderBudgetMs: 14000 };

export async function respond(deps: EngineDeps, a: RespondArgs): Promise<TurnResult> {
  const c = deps.curriculum;
  const { decision, nextState, prevState } = a;
  const prevSub = getSubconcept(c, prevState.subconceptId);
  const sub = getSubconcept(c, nextState.subconceptId);
  const answeredCheck = a.assessment?.intent === "answer" || a.assessment?.intent === "dont_know" ? getCheck(prevSub, prevState.pendingCheckId) : null;
  const pendingCheck = getCheck(sub, nextState.pendingCheckId);

  const system = composeSystemBoard(prevState, nextState, decision.action, sub, pendingCheck, !!answeredCheck);
  const ctx = buildResponderContext(c, a, { prevSub, sub, answeredCheck, pendingCheck, board: system.board });

  const t = deps.timeouts ?? RESPONDER_TIMEOUTS;
  const { value, telemetry } = await callJson({
    role: "responder",
    transport: deps.transport,
    health: deps.health,
    models: modelChain(deps.models.responder, deps.models),
    messages: responderMessages(ctx),
    schema: ResponderOutput,
    validate: (v) => leakProblem(writtenLines(v.board, v.solution), pendingCheck, prevState.pendingCheckId),
    maxTokens: 900,
    temperature: 0.5,
    timeoutMs: t.responderMs,
    budgetMs: t.responderBudgetMs,
  });
  a.calls.push(telemetry);
  const reply: ResponderReply = value ?? cannedResponse(c, ctx);

  const lessonOps = sanitiseLlmOps(reply.board, system.board);
  const whyOps = answeredCheck && a.assessment?.correct ? whyThatsRight(answeredCheck, reply.solution) : [];
  const applied = applyBoardOps(system.board, [...lessonOps, ...whyOps]);
  // On a new topic the "why" block sits at the top, above the fresh lesson; otherwise it follows the lesson.
  const board = NEW_TOPIC_ACTIONS.has(decision.action) ? [...applied.board.filter(isWhy), ...applied.board.filter((b) => !isWhy(b))] : applied.board;

  const askNext = pendingCheck && decision.action !== "complete" ? `${leadIn(decision.action)} ${pendingCheck.spoken}` : "";
  return {
    speech: [cleanSpeech(reply.speech), askNext].filter(Boolean).join(" "),
    boardOps: [...system.ops, ...applied.applied],
    board,
    decision,
    assessment: a.assessment,
    state: { ...nextState, board, recentDecisions: remember(prevState, decision) },
    telemetry: { promptVersion: PROMPT_VERSION, calls: a.calls, totalMs: Date.now() - a.started, degraded: a.calls.some((call) => call.usedFallback) },
    speechRate: 1,
  };
}

export function remember(prev: SessionState, d: Decision) {
  return [...(prev.recentDecisions ?? []), { action: d.action, reason: d.reason }].slice(-MEMORY);
}

/** System-owned board changes: clear for a new topic, drop the old "why" block, show the pending question. */
function composeSystemBoard(prev: SessionState, next: SessionState, action: TutorAction, sub: Subconcept | null, pending: CheckItem | null, answered: boolean) {
  const ops: BoardOp[] = [];
  // Last turn's "why that's right" block goes once the student has answered the next question.
  if (answered) ops.push(...prev.board.filter(isWhy).map((b) => ({ op: "remove" as const, id: b.id })));
  if (NEW_TOPIC_ACTIONS.has(action)) ops.push({ op: "clear" }, { op: "write", id: "title", kind: "text", content: sub?.title ?? "All topics complete" });
  const afterPre = applyBoardOps(prev.board, ops).board;
  const questionOps = questionBoardOps(afterPre, pending, prev.pendingCheckId !== next.pendingCheckId);
  return { ops: [...ops, ...questionOps], board: applyBoardOps(afterPre, questionOps).board };
}

function buildResponderContext(
  c: Curriculum,
  a: RespondArgs,
  x: { prevSub: Subconcept | null; sub: Subconcept | null; answeredCheck: CheckItem | null; pendingCheck: CheckItem | null; board: BoardItem[] },
): ResponderContext {
  const { decision, nextState, prevState } = a;
  const findMisconception = (id: string) => x.sub?.misconceptions.find((m) => m.id === id) ?? x.prevSub?.misconceptions.find((m) => m.id === id) ?? null;
  return {
    action: decision.action,
    decision,
    subconcept: x.sub,
    strategy: x.sub?.strategies[nextState.strategyIndex] ?? null,
    previousSubconcept: x.prevSub,
    answeredCheck: x.answeredCheck,
    assessment: a.assessment,
    pendingCheck: x.pendingCheck,
    board: x.board,
    history: a.history,
    studentText: a.studentText,
    flaggedTitles: c.subconcepts.filter((s) => nextState.progress[s.id]?.status === "needs_review").map((s) => s.title),
    recentDecisions: prevState.recentDecisions ?? [],
    celebrate: decision.celebrate ? findMisconception(decision.celebrate.misconceptionId) : null,
    finishedTopicMistakes: finishedTopicMistakes(x.prevSub, x.sub, decision.action, nextState),
  };
}

/** The student's mistakes in the topic just finished, most frequent first, for the end-of-topic recap. */
function finishedTopicMistakes(prevSub: Subconcept | null, sub: Subconcept | null, action: TutorAction, next: SessionState) {
  if (!prevSub || prevSub.id === sub?.id || !["advance", "move_on_flagged", "complete"].includes(action)) return [];
  const progress = next.progress[prevSub.id];
  return Object.entries(progress?.misconceptions ?? {})
    .sort((x, y) => y[1] - x[1])
    .flatMap(([id, count]) => {
      const m = prevSub.misconceptions.find((mm) => mm.id === id);
      return m ? [{ description: m.description, count, fixed: progress.fixed.includes(id) }] : [];
    });
}

/** The "✓ Why that's right" block: the worked solution of the question just answered. */
function whyThatsRight(answered: CheckItem, solution: ResponderReply["solution"]): BoardOp[] {
  const lines = solution.length ? solution : [{ kind: "text" as const, content: answered.solution }];
  return [
    { op: "write", id: "why_title", kind: "text", content: `✓ Why that's right: ${answered.text}` },
    ...(answered.math ? [{ op: "write" as const, id: "why_q", kind: "math" as const, content: answered.math }] : []),
    ...lines.map((l, i): BoardOp => ({ op: "write", id: `why_${i + 1}`, kind: l.kind, content: l.content })),
  ];
}

function questionBoardOps(board: BoardItem[], check: CheckItem | null, changed: boolean): BoardOp[] {
  const has = (id: string) => board.some((b) => b.id === id);
  if (!check) return [QUESTION_IDS.text, QUESTION_IDS.math].filter(has).map((id) => ({ op: "remove" as const, id }));
  if (!changed && has(QUESTION_IDS.text)) return [];
  const ops: BoardOp[] = [{ op: "write", id: QUESTION_IDS.text, kind: "text", content: `Your turn: ${check.text}` }];
  if (check.math) ops.push({ op: "write", id: QUESTION_IDS.math, kind: "math", content: check.math });
  else if (has(QUESTION_IDS.math)) ops.push({ op: "remove", id: QUESTION_IDS.math });
  return ops;
}

/** The LLM may not overwrite system lines, and "clear" only clears its own lines. */
function sanitiseLlmOps(ops: BoardOp[], board: BoardItem[]): BoardOp[] {
  return ops.flatMap((op): BoardOp[] => {
    if (op.op === "clear") return board.filter((b) => !RESERVED_IDS.has(b.id)).map((b) => ({ op: "remove", id: b.id }));
    if (op.op === "write" && (RESERVED_IDS.has(op.id) || isWhy(op))) return [];
    if (op.op === "remove") return [];
    // Plain-text lines aren't rendered as LaTeX; make "x^2" read as "x²".
    if (op.op === "write" && op.kind === "text") return [{ ...op, content: op.content.replace(/\^2/g, "²").replace(/\^3/g, "³") }];
    return [op];
  });
}

function leadIn(action: TutorAction): string {
  switch (action) {
    case "next_check":
      return "Here's another one.";
    case "answer_question":
    case "redirect":
    case "clarify":
      return "So, back to our question.";
    case "review":
      return "Here's your warm-up.";
    default:
      return "Now, your turn.";
  }
}

/** TTS reads symbols literally; strip what slipped through the prompt. */
export function cleanSpeech(s: string): string {
  return s
    .replace(/\$+/g, "")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\^2/g, " squared")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
