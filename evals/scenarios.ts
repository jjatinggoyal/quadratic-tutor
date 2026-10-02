import type { LlmTransport } from "../src/core/llm";
import type { BoardItem, SessionState, StudentIntent, TutorAction } from "../src/core/types";
import { garbageTransport, hangingTransport, outageTransport, scriptedTransport, stateAt } from "./fixtures";

// The regression suite. Each scenario is one student turn from a fixed state,
// with the tutor behaviour we expect. They are chosen to cover the places a
// prompt or model change is most likely to make the tutor worse:
//
//   grading      — does the assessor extract the right answer from messy speech?
//   the loop     — does the tutor re-teach / move on / hold at the right time?
//   pedagogy     — does a re-teach actually target the mistake, kindly, without
//                  leaking the next answer? (LLM judge)
//   resilience   — timeouts, garbage and outages degrade instead of breaking.
//
// Deterministic checks run first; the judge only scores what code can't.

export interface Expect {
  intent?: StudentIntent;
  correct?: boolean | null;
  action?: TutorAction;
  misconception?: string[]; // any of these ids is acceptable
  nextSubconcept?: string | null;
  pendingUnchanged?: boolean; // the same question stays open
  statusAfter?: Record<string, SessionState["progress"][string]["status"]>;
  degraded?: boolean;
  responderModel?: string;
  maxTotalMs?: number;
  speechMust?: RegExp[];
  speechMustNot?: RegExp[];
  maxWords?: number; // for the LLM-written part of the speech
  judge?: string[]; // rubric items for the LLM judge
  board?: (items: BoardItem[]) => string | null; // return a failure message, or null
}

export interface Scenario {
  id: string;
  catches: string; // the regression this scenario exists to catch
  state: () => SessionState;
  student: string;
  /** Override the transport (resilience scenarios). Receives the real one. */
  transport?: (real: LlmTransport, models: { assessor: string; responder: string; fallback: string }) => LlmTransport;
  timeouts?: { assessorMs: number; responderMs: number; assessorBudgetMs: number; responderBudgetMs: number };
  expect: Expect;
}

const FAST_TIMEOUTS = { assessorMs: 300, responderMs: 300, assessorBudgetMs: 700, responderBudgetMs: 700 };

export const scenarios: Scenario[] = [
  // ------------------------------------------------------------- grading
  {
    id: "stt-homophone-correct",
    catches: "Assessor stops tolerating speech-recognition noise ('for' = four) and marks a right answer wrong.",
    state: () => stateAt("factorisation", "fa_monic_mixed"),
    student: "x equals minus for and three",
    expect: { intent: "answer", correct: true, action: "next_check" },
  },
  {
    id: "hinglish-answer",
    catches: "Assessor fails on mixed Hindi-English replies, common for the target students.",
    state: () => stateAt("roots", "rt_neg_one_no"),
    student: "nahi, ye root nahi hai kyunki answer minus four aata hai",
    expect: { intent: "answer", correct: true, action: "next_check" },
  },
  {
    id: "working-without-answer",
    catches: "Assessor finishing the student's arithmetic and crediting an answer they never gave.",
    state: () => stateAt("discriminant", "dc_value"),
    student: "um, is it three squared minus four times one times minus four?",
    expect: { intent: "unclear", action: "clarify", pendingUnchanged: true },
  },
  {
    id: "self-contradiction",
    catches: "Grading one half of a self-contradicting reply instead of asking which the student meant.",
    state: () => stateAt("roots", "rt_neg_three_yes"),
    student: "no, because minus 3 squared plus minus 3 minus 6 is 9 minus 3 minus 6, which is zero",
    expect: { intent: "unclear", action: "clarify", pendingUnchanged: true, judge: ["Gently points out that the student's working gives zero, which conflicts with their 'no', and asks them to decide."] },
  },
  {
    id: "one-root-only",
    catches: "Half an answer (one of two roots) being accepted as correct.",
    state: () => stateAt("factorisation", "fa_nonmonic"),
    student: "x is 3",
    expect: { intent: "answer", correct: false, action: "reteach", misconception: ["one_root_only"] },
  },

  // ------------------------------------------------------------- the loop
  {
    id: "sign-error-reteach",
    catches: "A re-teach that repeats the same explanation, praises a wrong answer, or leaks the next answer.",
    state: () => stateAt("factorisation", "fa_monic_pos"),
    student: "it becomes x minus 2 into x minus 3 so the roots are minus 2 and minus 3",
    expect: {
      intent: "answer",
      correct: false,
      action: "reteach",
      misconception: ["root_sign_flip"],
      maxWords: 115,
      judge: [
        "Does not say or imply the student's final roots were right (acknowledging that the factorisation step itself was right is fine).",
        "Specifically addresses the sign of the roots: that x - 2 = 0 gives x = +2 (not -2).",
        "Explains in a different way from just restating the rule, e.g. by substituting back or reasoning about the zero-product step.",
        "Is kind and encouraging; does not make the student feel bad.",
      ],
    },
  },
  {
    id: "mastery-advances",
    catches: "The tutor failing to move on after mastery, or not actually starting the next topic.",
    state: () => stateAt("roots", "rt_neg_three_yes", { correctInARow: 1 }),
    student: "yes, because minus three squared is nine, nine minus three minus six is zero",
    expect: {
      intent: "answer",
      correct: true,
      action: "advance",
      nextSubconcept: "factorisation",
      statusAfter: { roots: "mastered", factorisation: "in_progress" },
      judge: [
        "Briefly acknowledges that the student got it right.",
        "Starts teaching solving by factorisation (splitting the middle term / zero-product), not more about checking roots.",
      ],
    },
  },
  {
    id: "just-tell-me",
    catches: "Tutor giving away answers on demand instead of re-teaching.",
    state: () => stateAt("discriminant", "dc_negative"),
    student: "I don't get it, just tell me the answer",
    expect: {
      intent: "dont_know",
      action: "reteach",
      judge: [
        "Explains how to decide the nature of roots using the discriminant, rather than only stating an answer.",
        "Does not scold or shame the student for asking.",
      ],
    },
  },
  {
    id: "question-mid-check",
    catches: "A student's question being graded as a wrong answer, or the pending question being dropped.",
    state: () => stateAt("quadratic_formula", "qf_neg_c"),
    student: "wait, why is it minus b in the formula and not just b?",
    expect: {
      intent: "question",
      action: "answer_question",
      pendingUnchanged: true,
      speechMustNot: [/\b1 and (minus|-) ?5\b/i, /\bminus 5 and 1\b/i],
      judge: ["Actually answers why the formula has -b, in a way a Class 10 student could follow, without hand-waving."],
    },
  },
  {
    id: "off-topic",
    catches: "The tutor getting drawn into unrelated chat or penalising the student for it.",
    state: () => stateAt("standard_form", "sf_find_b"),
    student: "did India win the cricket match yesterday?",
    expect: { intent: "off_topic", action: "redirect", pendingUnchanged: true, maxWords: 40 },
  },
  {
    id: "stuck-moves-on-flagged",
    catches: "An infinite re-teach loop for a student who is stuck.",
    state: () => stateAt("discriminant", "dc_value", { strategyIndex: 2, reteachesHere: 2 }),
    student: "is it 7?",
    expect: {
      intent: "answer",
      correct: false,
      action: "move_on_flagged",
      nextSubconcept: "word_problems",
      statusAfter: { discriminant: "needs_review", word_problems: "in_progress" },
      judge: [
        "Reassures the student and says the topic will be revisited.",
        "Gives or shows the correct discriminant value (25) for the missed question.",
        "Introduces word problems.",
      ],
    },
  },
  {
    id: "trap-not-quadratic",
    catches: "Grading by appearance: accepting 'it has x squared so it's quadratic' when x² cancels.",
    state: () => stateAt("standard_form", "sf_cancel_linear"),
    student: "yes it's quadratic because it has x squared in it",
    expect: {
      intent: "answer",
      correct: false,
      action: "reteach",
      misconception: ["no_simplify", "degree_confusion"],
      judge: ["Makes clear that you must expand/simplify first, and that here the x squared terms cancel."],
    },
  },

  // ------------------------------------------------------------- resilience
  {
    id: "llm-timeout",
    catches: "A hung provider hanging the student's turn instead of degrading.",
    state: () => stateAt("factorisation", "fa_monic_mixed"),
    student: "minus four and three",
    transport: () => hangingTransport,
    timeouts: FAST_TIMEOUTS,
    expect: { correct: true, action: "next_check", degraded: true, maxTotalMs: 2500 },
  },
  {
    id: "llm-garbage",
    catches: "Non-JSON model output crashing the turn or reaching the student.",
    state: () => stateAt("roots", "rt_two_yes"),
    student: "no",
    transport: () => garbageTransport,
    expect: { correct: false, action: "reteach", degraded: true, speechMustNot: [/not json|Sure! Here/i] },
  },
  {
    id: "primary-outage-fallback-model",
    catches: "An outage of the primary models taking the tutor down even though the fallback model is healthy.",
    state: () => stateAt("roots", "rt_two_yes"),
    student: "yes it is a root",
    transport: (real, m) => outageTransport([m.assessor, m.responder], real),
    expect: { correct: true, action: "next_check", degraded: false },
  },
  {
    id: "bad-board-ops",
    catches: "The LLM overwriting the question on the board or highlighting lines that don't exist.",
    state: () => stateAt("roots", "rt_two_yes"),
    student: "yes",
    transport: () =>
      scriptedTransport({
        assessor: { intent: "answer", numbers: null, yes_no: true, choice: null, misconception: null, note: "" },
        responder: {
          speech: "Nice work, that's right.",
          board: [
            { op: "write", id: "q_text", kind: "text", content: "HIJACKED" },
            { op: "highlight", id: "does_not_exist" },
            { op: "write", id: "step", kind: "math", content: "4 - 10 + 6 = 0" },
            { op: "highlight", id: "step", term: "= 0" },
          ],
        },
      }),
    expect: {
      correct: true,
      action: "next_check",
      degraded: false,
      board: (items) => {
        if (items.find((i) => i.id === "q_text")?.content === "HIJACKED") return "LLM overwrote the question line";
        if (!items.find((i) => i.id === "step")?.highlight) return "valid highlight was not applied";
        return null;
      },
    },
  },
];
