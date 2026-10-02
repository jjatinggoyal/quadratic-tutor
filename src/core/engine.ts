import { applyBoardOps } from "./board";
import { grade, heuristicExtract } from "./grader";
import { isNotReady, quickIntent, welcomeSpeech } from "./intents";
import { callJson, modelChain, type LlmTransport, type ModelConfig, type ProviderHealth } from "./llm";
import { decide, getCheck, getSubconcept, initialState, rebaseState, stateFromProgress } from "./policy";
import { assessorMessages, PROMPT_VERSION, type HistoryLine } from "./prompts";
import { remember, respond } from "./respond";
import { AssessorOutput } from "./schemas";
import type { Assessment, BoardItem, CheckItem, Curriculum, Decision, LlmCallTelemetry, SessionState, Subconcept, TurnResult } from "./types";

// One tutor turn = assess → decide → respond.
//
//   assess   LLM extracts intent + answer; the grader decides correctness.
//            If the LLM fails, a heuristic extractor takes over. A few short
//            replies ("repeat that", "not yet") are understood locally.
//   decide   Pure policy (policy.ts). No LLM.
//   respond  LLM writes speech + board ops for the decided action (respond.ts).
//            If the LLM fails, canned curriculum scripts take over.
//
// The engine never throws on LLM failure; it marks the turn `degraded`.

export interface EngineDeps {
  curriculum: Curriculum;
  transport: LlmTransport;
  models: ModelConfig;
  timeouts?: { assessorMs: number; responderMs: number; assessorBudgetMs: number; responderBudgetMs: number };
  /** Breaker / provider-down state. Defaults to one shared per isolate; evals pass a fresh one per run. */
  health?: ProviderHealth;
}

const ASSESSOR_TIMEOUTS = { assessorMs: 6000, assessorBudgetMs: 9000 };

export { initialState, rebaseState, stateFromProgress };

// ---------------------------------------------------------------------------

/** The tutor's first turn of a session (no student input yet). */
export async function openingTurn(deps: EngineDeps, state: SessionState, history: HistoryLine[]): Promise<TurnResult> {
  const started = Date.now();
  const c = deps.curriculum;
  const sub = getSubconcept(c, state.subconceptId);
  const check = getCheck(sub, state.pendingCheckId);

  // Checked before "resume": reloading after the welcome must not skip the lesson and jump to the question.
  if (state.awaitingStart) return greeting(c, state, started, "welcome");
  if (history.length > 0 || !sub || !check) return resumed(c, state, sub, check, started);

  if (state.review) {
    const back = getSubconcept(c, state.review.returnTo);
    return respond(deps, {
      ...fresh(state, history, started),
      decision: decisionFor("review", `New session for a returning student: starting with a retention check on "${sub.title}", mastered earlier, before continuing${back ? ` with "${back.title}"` : ""}.`, null, sub, check),
    });
  }

  const startedBefore = Object.values(state.progress).some((p) => p.checksAttempted > 0);
  return respond(deps, { ...fresh(state, history, started), decision: teachDecision(sub, check, state, startedBefore ? "New session: starting with the first topic not yet mastered" : "New session: starting with the first topic") });
}

/** One student turn. */
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

  // After the welcome: start the first lesson on any reply, unless they ask to wait.
  if (state.awaitingStart) {
    if (isNotReady(studentText)) return greeting(c, state, started, "wait");
    return respond(deps, {
      ...fresh(state, history, started),
      prevState: { ...state, pendingCheckId: null },
      nextState: { ...state, awaitingStart: false },
      studentText,
      decision: teachDecision(sub, check, state, "Student is ready; starting with the first topic"),
    });
  }

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
  if (decision.action === "repeat") return replay(state, nextState, decision, assessment, history, check, calls, started);
  return respond(deps, { prevState: state, nextState, decision, assessment, studentText, history, calls, started });
}

// ---------------------------------------------------------------------------

async function assess(deps: EngineDeps, sub: Subconcept, check: CheckItem, studentText: string, history: HistoryLine[]) {
  const t = deps.timeouts ?? ASSESSOR_TIMEOUTS;
  const { value, telemetry } = await callJson({
    role: "assessor",
    transport: deps.transport,
    health: deps.health,
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

  // "An answer" with nothing in it can't be graded; ask again rather than count it as wrong
  // (which would burn a re-teach and could flag the topic).
  if (assessment.intent === "answer" && isEmpty(assessment.extracted)) {
    assessment = { ...assessment, intent: "unclear", note: `${assessment.note} (no answer could be extracted)`.trim() };
  }
  if (assessment.intent === "answer") {
    assessment.correct = grade(check.answer, assessment.extracted);
    if (assessment.correct) assessment.misconceptionId = null;
  }
  return { assessment, telemetry };
}

function isEmpty(e: Assessment["extracted"]): boolean {
  return !e || ((e.numbers?.length ?? 0) === 0 && e.yesNo === undefined && !e.choice);
}

function toExtracted(check: CheckItem, v: AssessorOutput): Assessment["extracted"] {
  switch (check.answer.type) {
    case "number_set":
    case "number":
      return v.numbers.length ? { numbers: v.numbers } : null;
    case "yes_no":
      return v.yes_no === null ? null : { yesNo: v.yes_no };
    case "choice":
      return v.choice ? { choice: v.choice } : null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic turns: no LLM, so they are instant and can't fail.

function teachDecision(sub: Subconcept, check: CheckItem, state: SessionState, why: string): Decision {
  const strategy = sub.strategies[state.strategyIndex];
  return decisionFor("teach", `${why}, "${sub.title}", using strategy "${strategy.name}".`, strategy.id, sub, check);
}

function decisionFor(action: Decision["action"], reason: string, strategyId: string | null, sub: Subconcept | null, check: CheckItem | null): Decision {
  return { action, reason, fromSubconceptId: null, toSubconceptId: sub?.id ?? null, strategyId, checkId: check?.id ?? null };
}

/** respond() args for a session's first lesson turn: fresh board, question not yet shown. */
function fresh(state: SessionState, history: HistoryLine[], started: number) {
  return { prevState: { ...state, board: [], pendingCheckId: null }, nextState: state, assessment: null, studentText: null, history, calls: [], started };
}

function fixedTurn(state: SessionState, decision: Decision, speech: string, board: BoardItem[], started: number, extra: Partial<TurnResult> = {}): TurnResult {
  return {
    speech,
    boardOps: [],
    board,
    decision,
    assessment: null,
    state: { ...state, board, recentDecisions: remember(state, decision) },
    telemetry: { promptVersion: PROMPT_VERSION, calls: [], totalMs: Date.now() - started, degraded: false },
    speechRate: 1,
    ...extra,
  };
}

/** The welcome (and "take your time") turns. */
function greeting(c: Curriculum, state: SessionState, started: number, kind: "welcome" | "wait"): TurnResult {
  const board =
    kind === "welcome"
      ? applyBoardOps([], [
          { op: "write", id: "title", kind: "text", content: "Welcome!" },
          { op: "write", id: "w_1", kind: "text", content: `Quadratic equations in ${c.subconcepts.length} short steps` },
          { op: "write", id: "w_2", kind: "math", content: "ax^2 + bx + c = 0" },
          { op: "write", id: "w_3", kind: "text", content: "I explain → you try a question → we move on when it clicks" },
          { op: "write", id: "w_4", kind: "text", content: "Speak or type · ask anything · say “repeat”" },
          { op: "highlight", id: "w_2" },
        ]).board
      : state.board;
  const decision = decisionFor(
    "greet",
    kind === "welcome" ? "First ever session: introducing Tara and how the lesson works, then waiting until the student is ready." : "Student asked to wait; holding the lesson until they're ready.",
    null,
    getSubconcept(c, state.subconceptId),
    null,
  );
  const speech = kind === "welcome" ? welcomeSpeech(c) : "No problem, take your time. Just say ready when you want to start.";
  return fixedTurn(state, decision, speech, board, started);
}

/** Returning to an open session (e.g. after a reload): re-ask the pending question. */
function resumed(c: Curriculum, state: SessionState, sub: Subconcept | null, check: CheckItem | null, started: number): TurnResult {
  const decision: Decision = {
    ...decisionFor(sub ? "resume" : "complete", sub ? `Resuming a saved session at "${sub.title}".` : "Session already complete.", sub?.strategies[state.strategyIndex]?.id ?? null, sub, check),
    fromSubconceptId: state.subconceptId,
  };
  const speech =
    sub && check
      ? `Welcome back! We were working on ${sub.title.toLowerCase()}. Let's pick up where we left off. ${check.spoken}`
      : `Welcome back! You've already finished all ${c.subconcepts.length} topics. Great work.`;
  return fixedTurn(state, decision, speech, state.board, started);
}

/** "Repeat that": the last thing the tutor said, word for word; slower if asked. */
function replay(prev: SessionState, next: SessionState, decision: Decision, assessment: Assessment, history: HistoryLine[], pending: CheckItem, calls: LlmCallTelemetry[], started: number): TurnResult {
  const last = [...history].reverse().find((h) => h.role === "tutor")?.text;
  return {
    speech: last ?? `Here's the question again. ${pending.spoken}`,
    boardOps: [],
    board: prev.board,
    decision,
    assessment,
    // Not remembered as a decision: "why did you…" questions should see the last real one.
    state: next,
    telemetry: { promptVersion: PROMPT_VERSION, calls, totalMs: Date.now() - started, degraded: false },
    speechRate: assessment.slower ? 0.75 : 1,
  };
}
