import { applyBoardOps, isWhy, QUESTION_IDS } from "./board";
import { describeAnswer, grade, heuristicExtract } from "./grader";
import { callJson, modelChain, type LlmTransport, type ModelConfig } from "./llm";
import { nearDuplicate } from "./mathcheck";
import { decide, getCheck, getSubconcept, initialState, rebaseState, stateFromProgress } from "./policy";
import { assessorMessages, PROMPT_VERSION, responderMessages, type HistoryLine, type ResponderContext } from "./prompts";
import { AssessorOutput, ResponderOutput } from "./schemas";
import type {
  Assessment,
  BoardItem,
  BoardOp,
  CheckItem,
  Curriculum,
  Decision,
  LlmCallTelemetry,
  SessionState,
  Subconcept,
  TurnResult,
  TutorAction,
} from "./types";

// One tutor turn = assess → decide → respond.
//
//   assess   LLM extracts intent + answer; the grader decides correctness.
//            If the LLM fails, a heuristic extractor takes over.
//   decide   Pure policy (policy.ts). No LLM.
//   respond  LLM writes speech + board ops for the decided action.
//            If the LLM fails, canned curriculum scripts take over.
//
// The engine never throws on LLM failure; it marks the turn `degraded`.

export interface EngineDeps {
  curriculum: Curriculum;
  transport: LlmTransport;
  models: ModelConfig;
  timeouts?: { assessorMs: number; responderMs: number; assessorBudgetMs: number; responderBudgetMs: number };
}

const DEFAULT_TIMEOUTS = { assessorMs: 6000, responderMs: 9000, assessorBudgetMs: 9000, responderBudgetMs: 14000 };

export { initialState, rebaseState, stateFromProgress };

// ---------------------------------------------------------------------------

export async function openingTurn(deps: EngineDeps, state: SessionState, history: HistoryLine[]): Promise<TurnResult> {
  const started = Date.now();
  const c = deps.curriculum;
  const sub = getSubconcept(c, state.subconceptId);
  const check = getCheck(sub, state.pendingCheckId);

  // Returning student: resume deterministically, no LLM needed.
  if (history.length > 0 || !sub || !check) {
    const decision: Decision = {
      action: sub ? "answer_question" : "complete",
      reason: sub ? `Resuming a saved session at "${sub.title}".` : "Session already complete.",
      fromSubconceptId: state.subconceptId,
      toSubconceptId: state.subconceptId,
      strategyId: sub?.strategies[state.strategyIndex]?.id ?? null,
      checkId: state.pendingCheckId,
    };
    const speech = sub && check
      ? `Welcome back! We were working on ${sub.title.toLowerCase()}. Let's pick up where we left off. ${check.spoken}`
      : "Welcome back! You've already finished all six topics. Great work.";
    return {
      speech,
      boardOps: [],
      board: state.board,
      decision,
      assessment: null,
      state,
      telemetry: { promptVersion: PROMPT_VERSION, calls: [], totalMs: Date.now() - started, degraded: false },
      speechRate: 1,
    };
  }

  if (state.review) {
    const back = getSubconcept(c, state.review.returnTo);
    const decision: Decision = {
      action: "review",
      reason: `New session for a returning student: starting with a retention check on "${sub.title}", mastered earlier, before continuing${back ? ` with "${back.title}"` : ""}.`,
      fromSubconceptId: null,
      toSubconceptId: sub.id,
      strategyId: null,
      checkId: check.id,
    };
    return respond(deps, { prevState: { ...state, board: [], pendingCheckId: null }, nextState: state, decision, assessment: null, studentText: null, history, calls: [], started });
  }

  const started_any = Object.values(state.progress).some((p) => p.checksAttempted > 0);
  const decision: Decision = {
    action: "teach",
    reason: `New session: starting with ${started_any ? "the first topic not yet mastered" : "the first topic"}, "${sub.title}", using strategy "${sub.strategies[state.strategyIndex].name}".`,
    fromSubconceptId: null,
    toSubconceptId: sub.id,
    strategyId: sub.strategies[state.strategyIndex].id,
    checkId: check.id,
  };
  return respond(deps, { prevState: { ...state, board: [], pendingCheckId: null }, nextState: state, decision, assessment: null, studentText: null, history, calls: [], started });
}

export async function runTurn(deps: EngineDeps, state: SessionState, history: HistoryLine[], studentText: string): Promise<TurnResult> {
  const started = Date.now();
  const c = deps.curriculum;
  const calls: LlmCallTelemetry[] = [];
  const sub = getSubconcept(c, state.subconceptId);
  const check = getCheck(sub, state.pendingCheckId);

  if (!sub || !check) {
    const { decision } = decide(c, state, { intent: "unclear", extracted: null, misconceptionId: null, note: "", correct: null, source: "heuristic" });
    return respond(deps, { prevState: state, nextState: state, decision, assessment: null, studentText, history, calls, started });
  }

  // "Repeat that" / "slower please" needs no LLM: answer it instantly.
  const quick = quickIntent(studentText);
  let assessment: Assessment;
  if (quick) {
    assessment = quick;
  } else {
    const assessed = await assess(deps, sub, check, studentText, history);
    assessment = assessed.assessment;
    calls.push(assessed.telemetry);
  }
  const { decision, state: nextState } = decide(c, state, assessment);
  return respond(deps, { prevState: state, nextState, decision, assessment, studentText, history, calls, started });
}

// ---------------------------------------------------------------------------

async function assess(deps: EngineDeps, sub: Subconcept, check: CheckItem, studentText: string, history: HistoryLine[]) {
  const t = deps.timeouts ?? DEFAULT_TIMEOUTS;
  const { value, telemetry } = await callJson({
    role: "assessor",
    transport: deps.transport,
    models: modelChain(deps.models.assessor, deps.models),
    messages: assessorMessages(sub, check, studentText, history),
    schema: AssessorOutput,
    maxTokens: 300,
    temperature: 0,
    timeoutMs: t.assessorMs,
    budgetMs: t.assessorBudgetMs,
  });

  let assessment: Assessment;
  if (value) {
    const knownMisconception = sub.misconceptions.some((m) => m.id === value.misconception);
    assessment = {
      intent: value.intent,
      extracted: value.intent === "answer" ? toExtracted(check, value) : null,
      misconceptionId: knownMisconception ? value.misconception : null,
      note: value.note,
      correct: null,
      source: "llm",
      ...(value.intent === "repeat" ? { slower: value.slower } : {}),
    };
  } else {
    assessment = heuristicExtract(check.answer, studentText);
  }
  if (assessment.intent === "answer") {
    assessment.correct = grade(check.answer, assessment.extracted);
    if (assessment.correct) assessment.misconceptionId = null;
  }
  return { assessment, telemetry };
}

const REPEAT_RE = /\b(repeat|again|once more|one more time|didn'?t (hear|catch)|come again|pardon|dobara|phir se)\b/i;
const SLOWER_RE = /\b(slow(er|ly)?|too fast|dheere)\b/i;

/** Short, unambiguous requests to replay the last turn. Anything longer goes to the assessor. */
export function quickIntent(text: string): Assessment | null {
  const words = text.trim().split(/\s+/).length;
  if (words > 8 || /\d|explain|why|how|what|step|part/i.test(text)) return null;
  const slower = SLOWER_RE.test(text);
  if (!slower && !REPEAT_RE.test(text)) return null;
  return { intent: "repeat", slower, extracted: null, misconceptionId: null, note: "matched a repeat request locally", correct: null, source: "heuristic" };
}

function toExtracted(check: CheckItem, v: AssessorOutput): Assessment["extracted"] {
  switch (check.answer.type) {
    case "number_set":
    case "number":
      return { numbers: v.numbers };
    case "yes_no":
      return v.yes_no === null ? null : { yesNo: v.yes_no };
    case "choice":
      return v.choice ? { choice: v.choice } : null;
  }
}

// ---------------------------------------------------------------------------

interface RespondArgs {
  prevState: SessionState;
  nextState: SessionState;
  decision: Decision;
  assessment: Assessment | null;
  studentText: string | null;
  history: HistoryLine[];
  calls: LlmCallTelemetry[];
  started: number;
}

const RESERVED_IDS = new Set<string>([QUESTION_IDS.text, QUESTION_IDS.math, "title"]);
const NEW_TOPIC_ACTIONS = new Set<TutorAction>(["teach", "advance", "move_on_flagged", "complete", "review"]);

async function respond(deps: EngineDeps, a: RespondArgs): Promise<TurnResult> {
  const c = deps.curriculum;
  const t = deps.timeouts ?? DEFAULT_TIMEOUTS;
  const { decision, nextState, prevState } = a;
  const action = decision.action;

  const prevSub = getSubconcept(c, prevState.subconceptId);
  const sub = getSubconcept(c, nextState.subconceptId);

  // Repeat: replay the last thing the tutor said, word for word. No LLM, no state change.
  if (action === "repeat") {
    const last = [...a.history].reverse().find((h) => h.role === "tutor")?.text;
    const pending = getCheck(sub, nextState.pendingCheckId);
    return {
      speech: last ?? (pending ? `Here's the question again. ${pending.spoken}` : "Let's keep going."),
      boardOps: [],
      board: prevState.board,
      decision,
      assessment: a.assessment,
      state: nextState,
      telemetry: { promptVersion: PROMPT_VERSION, calls: a.calls, totalMs: Date.now() - a.started, degraded: false },
      speechRate: a.assessment?.slower ? 0.75 : 1,
    };
  }

  const answeredCheck = a.assessment?.intent === "answer" || a.assessment?.intent === "dont_know" ? getCheck(prevSub, prevState.pendingCheckId) : null;
  const pendingCheck = getCheck(sub, nextState.pendingCheckId);
  const strategy = sub?.strategies[nextState.strategyIndex] ?? null;

  // 1. System board ops: fresh board + title for a new topic, then the pending question.
  const pre: BoardOp[] = [];
  // Last turn's "why that's right" block goes once the student has answered the next question.
  if (answeredCheck) pre.push(...prevState.board.filter(isWhy).map((b) => ({ op: "remove" as const, id: b.id })));
  if (NEW_TOPIC_ACTIONS.has(action)) {
    pre.push({ op: "clear" }, { op: "write", id: "title", kind: "text", content: sub?.title ?? "All topics complete" });
  }
  let board = applyBoardOps(prevState.board, pre).board;
  const questionOps = questionBoardOps(board, pendingCheck, prevState.pendingCheckId !== nextState.pendingCheckId);
  board = applyBoardOps(board, questionOps).board;

  // 2. LLM speech + board ops.
  const ctx: ResponderContext = {
    action,
    decision,
    subconcept: sub,
    strategy,
    previousSubconcept: prevSub,
    answeredCheck,
    assessment: a.assessment,
    pendingCheck,
    board,
    history: a.history,
    studentText: a.studentText,
    flaggedTitles: c.subconcepts.filter((s) => nextState.progress[s.id]?.status === "needs_review").map((s) => s.title),
    recentDecisions: prevState.recentDecisions ?? [],
    celebrate: decision.celebrate ? (sub?.misconceptions.find((m) => m.id === decision.celebrate!.misconceptionId) ?? prevSub?.misconceptions.find((m) => m.id === decision.celebrate!.misconceptionId) ?? null) : null,
    finishedTopicMistakes:
      prevSub && prevSub.id !== sub?.id && ["advance", "move_on_flagged", "complete"].includes(action)
        ? Object.entries(nextState.progress[prevSub.id]?.misconceptions ?? {})
            .sort((x, y) => y[1] - x[1])
            .flatMap(([id, n]) => {
              const m = prevSub.misconceptions.find((mm) => mm.id === id);
              return m ? [{ description: m.description, count: n, fixed: nextState.progress[prevSub.id].fixed.includes(id) }] : [];
            })
        : [],
  };
  const { value, telemetry } = await callJson({
    role: "responder",
    transport: deps.transport,
    models: modelChain(deps.models.responder, deps.models),
    messages: responderMessages(ctx),
    schema: ResponderOutput,
    validate: (v) => leakProblem({ board: [...v.board, ...v.solution.map((l, i) => ({ op: "write" as const, id: `why_${i}`, ...l }))] }, pendingCheck, prevState.pendingCheckId),
    maxTokens: 900,
    temperature: 0.5,
    timeoutMs: t.responderMs,
    budgetMs: t.responderBudgetMs,
  });
  a.calls.push(telemetry);

  const out = value ?? cannedResponse(ctx);
  const llmOps = sanitiseLlmOps(out.board, board);

  // 3. After a correct answer, show WHY it was right: the worked solution of that question.
  const whyOps: BoardOp[] = [];
  if (answeredCheck && a.assessment?.correct) {
    const lines = out.solution.length ? out.solution : [{ kind: "text" as const, content: answeredCheck.solution }];
    whyOps.push({ op: "write", id: "why_title", kind: "text", content: `✓ Why that's right: ${answeredCheck.text}` });
    if (answeredCheck.math) whyOps.push({ op: "write", id: "why_q", kind: "math", content: answeredCheck.math });
    lines.forEach((l, i) => whyOps.push({ op: "write", id: `why_${i + 1}`, kind: l.kind, content: l.content }));
  }
  const applied = applyBoardOps(board, [...llmOps, ...whyOps]);
  // On a new topic the "why" block sits at the top, above the fresh lesson; otherwise it follows the lesson.
  const result = NEW_TOPIC_ACTIONS.has(action)
    ? { ...applied, board: [...applied.board.filter(isWhy), ...applied.board.filter((b) => !isWhy(b))] }
    : applied;

  const speech = [cleanSpeech(out.speech), pendingCheck && action !== "complete" ? `${leadIn(action)} ${pendingCheck.spoken}` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    speech,
    boardOps: [...pre, ...questionOps, ...result.applied],
    board: result.board,
    decision,
    assessment: a.assessment,
    state: {
      ...nextState,
      board: result.board,
      recentDecisions: [...(prevState.recentDecisions ?? []), { action, reason: decision.reason }].slice(-MEMORY),
    },
    telemetry: {
      promptVersion: PROMPT_VERSION,
      calls: a.calls,
      totalMs: Date.now() - a.started,
      degraded: a.calls.some((call) => call.usedFallback),
    },
    speechRate: 1,
  };
}

/** How many past decisions the tutor remembers (and can explain). */
const MEMORY = 4;

const normMath = (s: string) => s.replace(/\\[,;!]|\\quad|\s/g, "");

/**
 * Guard against the most common pedagogical failure: teaching with the very
 * question the student is about to be asked. Only checked when the question is
 * new this turn (re-asking an open question is fine to discuss).
 */
function leakProblem(v: { board: BoardOp[] }, pending: CheckItem | null, previousCheckId: string | null): string | null {
  if (!pending || pending.id === previousCheckId) return null;
  const writes = v.board.flatMap((op) => (op.op === "write" ? [normMath(op.content)] : []));
  if (pending.math) {
    const target = normMath(pending.math.split("=")[0]);
    const mathWrites = v.board.flatMap((op) => (op.op === "write" && op.kind === "math" ? [op.content] : []));
    // Also catch sign-flipped copies (x^2 + 5x + 6 before asking x^2 - 5x + 6); check each "=" equation in a line.
    const equations = mathWrites.flatMap((c) => c.split(/\\Rightarrow|\\quad|\\;|,|:/).filter((part) => part.includes("=")));
    if (writes.some((w) => w.includes(target)) || equations.some((e) => nearDuplicate(e, pending.math!))) {
      return `the board uses the upcoming question's equation (${pending.math}) or a sign-flipped copy of it; use a clearly different example`;
    }
    return null;
  }
  // Word problems: the distinctive numbers of the story (e.g. 306) must not appear on the board.
  const numbers = [...new Set(pending.text.match(/\d{2,}/g) ?? [])];
  const hit = numbers.find((n) => writes.some((w) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(w)));
  return hit ? `the board works through the upcoming word problem (it uses ${hit}); use a different example` : null;
}

function questionBoardOps(board: BoardItem[], check: CheckItem | null, changed: boolean): BoardOp[] {
  const has = (id: string) => board.some((b) => b.id === id);
  if (!check) {
    return [QUESTION_IDS.text, QUESTION_IDS.math].filter(has).map((id) => ({ op: "remove" as const, id }));
  }
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

// ---------------------------------------------------------------------------
// Canned responses: the tutor keeps teaching from curriculum scripts when the
// LLM is unavailable. Less personal, still correct.

function cannedResponse(ctx: ResponderContext): { speech: string; board: BoardOp[]; solution: { kind: "text" | "math"; content: string }[] } {
  return { solution: [], ...cannedSpeechAndBoard(ctx) };
}

function cannedSpeechAndBoard(ctx: ResponderContext): { speech: string; board: BoardOp[] } {
  const script = ctx.strategy?.fallback;
  const scriptOps: BoardOp[] = (script?.board ?? []).map((b, i) => ({ op: "write", id: `fb_${i + 1}`, kind: b.kind, content: b.content }));
  const missed = ctx.answeredCheck ? ` The answer was ${describeAnswer(ctx.answeredCheck.answer)}.` : "";

  switch (ctx.action) {
    case "teach":
      return { speech: script?.speech ?? "", board: scriptOps };
    case "advance":
      return { speech: `That's right, well done. You've got this topic. Next: ${ctx.subconcept?.title}. ${script?.speech ?? ""}`, board: scriptOps };
    case "reteach":
      return { speech: `Not quite.${missed} Let's look at it another way. ${script?.speech ?? ""}`, board: scriptOps };
    case "move_on_flagged":
      return { speech: `That one is tricky.${missed} We'll come back to it later. Next: ${ctx.subconcept?.title}. ${script?.speech ?? ""}`, board: scriptOps };
    case "next_check":
      return { speech: "That's right, well done.", board: [] };
    case "answer_question":
      return { speech: "Good question. Let's keep going, and I'll explain more as we work through it.", board: [] };
    case "redirect":
      return { speech: "Let's get back to our maths.", board: [] };
    case "clarify":
      return { speech: "Sorry, I didn't catch that. Could you say your answer again?", board: [] };
    case "complete":
      return { speech: "Congratulations! You've worked through all six topics on quadratic equations.", board: [] };
    case "review":
      return { speech: `Welcome back! Let's start with a quick warm-up from ${ctx.subconcept?.title.toLowerCase() ?? "last time"}, to check it stuck.`, board: [] };
    case "repeat":
      return { speech: "", board: [] };
  }
}
