// Shared types for the tutor core. Everything in src/core is pure TypeScript
// with no Worker or DOM dependencies, so the same code runs in the Worker,
// the eval suite and the simulator.

// ---------- Curriculum ----------

export type AnswerSpec =
  | { type: "number_set"; values: string[] } // unordered set, e.g. roots ["2","3"]; fractions allowed ("1/2")
  | { type: "number"; value: string; tolerance?: number }
  | { type: "yes_no"; value: boolean }
  | { type: "choice"; options: { id: string; label: string }[]; value: string };

export interface CheckItem {
  id: string;
  /** Shown on the whiteboard. */
  text: string;
  /** Optional equation shown on the whiteboard under the text (LaTeX). */
  math?: string;
  /** How the tutor reads the question aloud (no LaTeX). */
  spoken: string;
  answer: AnswerSpec;
  /** Short worked solution, given to the LLM when re-teaching after a miss. */
  solution: string;
}

export interface Strategy {
  id: string;
  name: string;
  /** Guidance for the LLM on how to teach with this strategy. */
  guidance: string;
  /** Misconception ids this strategy is designed to fix; used to pick the re-teach strategy. */
  targets: string[];
  /** Used verbatim when the LLM is unavailable. */
  fallback: { speech: string; board: { kind: "text" | "math"; content: string }[] };
}

export interface Misconception {
  id: string;
  description: string;
}

export interface Subconcept {
  id: string;
  title: string;
  objective: string;
  keyFacts: string[];
  strategies: Strategy[]; // index 0 is the first explanation; later ones are re-teach strategies
  misconceptions: Misconception[];
  checks: CheckItem[];
  mastery: { correctInARow: number; maxReteaches: number };
}

export interface Curriculum {
  id: string;
  version: string;
  title: string;
  subconcepts: Subconcept[];
}

// ---------- Board ----------

export interface BoardItem {
  id: string;
  kind: "text" | "math";
  content: string;
  /** Present when the item (or a term inside it) is highlighted. */
  highlight?: { term?: string };
}

export type BoardOp =
  | { op: "write"; id: string; kind: "text" | "math"; content: string }
  | { op: "highlight"; id: string; term?: string }
  | { op: "clear" }
  | { op: "remove"; id: string }; // system-only; the LLM cannot emit it

// ---------- Session state ----------

export type SubconceptStatus = "not_started" | "in_progress" | "mastered" | "needs_review";

export interface SubconceptProgress {
  subconceptId: string;
  status: SubconceptStatus;
  checksAttempted: number;
  checksCorrect: number;
  reteachCount: number;
  strategiesUsed: string[];
}

/** Everything needed to resume a session exactly where it stopped. */
export interface SessionState {
  curriculumId: string;
  curriculumVersion: string;
  subconceptId: string | null; // null once the curriculum is complete
  strategyIndex: number;
  pendingCheckId: string | null;
  usedCheckIds: string[]; // within the current subconcept
  correctInARow: number;
  reteachesHere: number;
  board: BoardItem[];
  progress: Record<string, SubconceptProgress>;
}

// ---------- Turn pipeline ----------

export type StudentIntent = "answer" | "dont_know" | "question" | "off_topic" | "unclear";

export interface Assessment {
  intent: StudentIntent;
  /** Normalised answer the student gave, shaped by the check's answer type. */
  extracted: { numbers?: string[]; yesNo?: boolean; choice?: string } | null;
  misconceptionId: string | null;
  note: string;
  /** Result of the deterministic grader; null when the student did not answer. */
  correct: boolean | null;
  /** Where the assessment came from, useful when debugging degraded turns. */
  source: "llm" | "heuristic";
}

export type TutorAction =
  | "teach" // introduce a subconcept (first strategy)
  | "next_check" // correct, ask another question on the same subconcept
  | "advance" // mastered; praise and teach the next subconcept
  | "reteach" // wrong or "don't know"; explain differently, then a fresh check
  | "move_on_flagged" // still wrong after max re-teaches; flag and move on
  | "answer_question" // student asked something; answer, then re-ask the pending check
  | "redirect" // off-topic; steer back
  | "clarify" // could not understand the student
  | "complete"; // curriculum finished

export interface Decision {
  action: TutorAction;
  /** Human-readable explanation of why the policy chose this action. */
  reason: string;
  fromSubconceptId: string | null;
  toSubconceptId: string | null;
  strategyId: string | null;
  checkId: string | null;
}

export interface TurnResult {
  speech: string;
  boardOps: BoardOp[];
  board: BoardItem[];
  decision: Decision;
  assessment: Assessment | null;
  state: SessionState;
  telemetry: TurnTelemetry;
}

export interface LlmCallTelemetry {
  role: "assessor" | "responder";
  model: string | null;
  attempts: { model: string; ok: boolean; ms: number; error?: string }[];
  ms: number;
  tokensIn: number;
  tokensOut: number;
  usedFallback: boolean; // true when the canned / heuristic path was used
}

export interface TurnTelemetry {
  promptVersion: string;
  calls: LlmCallTelemetry[];
  totalMs: number;
  degraded: boolean;
}
