import { describeAnswer } from "./grader";
import type { ChatMessage } from "./llm";
import type { Assessment, BoardItem, CheckItem, Decision, DecisionMemo, Misconception, Strategy, Subconcept, TutorAction } from "./types";

// Bump whenever either prompt changes. It is stored on every turn so a quality
// change can be traced to a prompt change (see DESIGN.md, Observability).
export const PROMPT_VERSION = "p-2026-10-02.1";

export interface HistoryLine {
  role: "student" | "tutor";
  text: string;
}

// ---------------------------------------------------------------------------
// Assessor: classifies the student's utterance and extracts their answer.
// It never talks to the student and it does not decide correctness.

export function assessorMessages(sub: Subconcept, check: CheckItem, studentText: string, history: HistoryLine[]): ChatMessage[] {
  const spec = check.answer;
  const shape =
    spec.type === "number_set" || spec.type === "number"
      ? `"numbers": the value(s) the student gives as their FINAL answer, as strings ("3", "-1/2", "0.5"). Do not include numbers they only read out from the question or mention as working.`
      : spec.type === "yes_no"
        ? `"yes_no": true if they answer yes, false if no.`
        : `"choice": exactly one of ${spec.options.map((o) => `"${o.id}" (${o.label})`).join(", ")}.`;

  const system = `You are the assessment module of a maths tutor for Indian Class 10 students. You never talk to the student.
Given the question the tutor asked and the student's reply, classify the reply and extract the student's answer.

The reply comes from speech recognition, so expect errors: "to"/"too" often means two, "for" may mean four, "by" means divided by ("3 by 2" = 3/2), numbers may be words, punctuation is missing, and students may mix Hindi and English.

intent (pick one):
- "answer": they attempt an answer, even if it is wrong, partial, or hedged ("maybe 3?").
- "dont_know": they say they don't know, give up, or ask to just be told the answer.
- "question": they ask about the maths or the lesson, ask you to explain something (a step, a word), or ask about the lesson itself — why you moved on, why you're explaining again, why the question changed, how they're doing.
- "repeat": they only ask to hear the last thing again, or to say it more slowly; set "slower": true if they want it slower.
- "off_topic": unrelated to the lesson and to the tutoring session.
- "unclear": you cannot tell what they mean, OR they only read out working without stating a final answer, OR their reply contradicts itself (e.g. "no, it's not a root" but their working shows it gives zero).

Extract only for intent "answer". ${shape} Use null for fields that do not apply.
Extract only what the student actually said. Never compute, finish or correct their working for them: if they say "three squared minus four times minus four" without a result, that is not an answer.

"misconception": if the answer is wrong, the id from the list below that best explains the mistake, otherwise null.
"note": one short sentence on what the student did or seems to think.

Respond with a single JSON object: {"intent", "numbers", "yes_no", "choice", "misconception", "note", "slower"}.`;

  const recent = history.slice(-4).map((h) => `${h.role === "tutor" ? "Tutor" : "Student"}: ${h.text}`).join("\n");
  const user = `Topic: ${sub.title}
Question asked: ${check.text}${check.math ? `  ${check.math}` : ""}
Correct answer (for your reference only, to spot misconceptions): ${describeAnswer(spec)}
Known misconceptions:
${sub.misconceptions.map((m) => `- ${m.id}: ${m.description}`).join("\n")}

Recent conversation:
${recent || "(none)"}

Student's reply: """${studentText}"""`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ---------------------------------------------------------------------------
// Responder: writes what the tutor says and puts on the board, for an action
// that the policy has ALREADY decided. It cannot change the decision.

const ACTION_BRIEF: Record<TutorAction, string> = {
  teach:
    "Introduce the topic using the strategy below. Keep it short: one idea and one tiny example. Build the board step by step.",
  next_check:
    "The student got it right. Confirm briefly and specifically what they did right (one sentence). Do not re-teach.",
  advance:
    "The student has mastered the previous topic (or, if the decision says so, passed a warm-up check on an earlier topic). Congratulate them in one sentence and recap the finished topic in one sentence — if 'Mistakes in the finished topic' are listed, name the one to remember. Then introduce the NEW topic using the strategy below.",
  reteach:
    "The student got it wrong or didn't know. Be kind and never make them feel bad. Walk through the question they just missed, step by step, using its worked solution, and put those steps on the board. Point at the exact step where their answer went wrong (the likely misconception) and say what the correct step gives. Explain it using the NEW strategy below — a different angle from before, not a repeat of the rule. If they said they didn't know, don't talk about a mistake; just explain more simply.",
  move_on_flagged:
    "The student is still stuck after several explanations. Reassure them warmly, show the correct solution of the question they missed in one or two steps, name the one thing to remember from this topic, say you'll come back to it later, then introduce the NEW topic using the strategy below.",
  answer_question:
    "The student asked a question. Give the real reason, not just a restatement of the rule, in a way a Class 10 student can follow, and put the one key step on the board. If they ask about a specific step or part of your explanation, explain exactly that part, using the same example as before. If they ask why YOU did something (moved on, re-explained, changed the question), answer truthfully from 'Your recent decisions' — never invent a reason. Do not give away the answer to the pending question.",
  redirect:
    "The student went off-topic. Respond in one friendly sentence and bring them back to the lesson.",
  clarify:
    "The student's reply wasn't a clear final answer (you couldn't make it out, they only gave working, or they contradicted themselves — if so, point out the contradiction gently). In one or two sentences, say kindly what you understood, and ask for their final answer. If they were mid-working, encourage them to finish the step.",
  complete:
    "The student has finished all six topics. Congratulate them, recap the journey in two sentences, and mention any topic flagged for review.",
  review:
    "A returning student is starting a new session. Welcome them back warmly in one sentence and say you'll start with a quick warm-up question on the topic below (name it), to check it stuck. Do not teach or give hints.",
  repeat: "Not used: repeats are replayed without the LLM.",
};

const WORD_LIMIT: Record<TutorAction, number> = {
  teach: 90,
  advance: 120,
  reteach: 100,
  move_on_flagged: 120,
  next_check: 35,
  answer_question: 90,
  redirect: 30,
  clarify: 30,
  complete: 70,
  review: 40,
  repeat: 0,
};

export interface ResponderContext {
  action: TutorAction;
  decision: Decision;
  subconcept: Subconcept | null; // the topic being taught after this turn
  strategy: Strategy | null;
  previousSubconcept: Subconcept | null; // for advance / move_on_flagged
  answeredCheck: CheckItem | null; // the question the student just answered
  assessment: Assessment | null;
  pendingCheck: CheckItem | null; // question the system will ask at the end of this turn
  board: BoardItem[];
  history: HistoryLine[];
  studentText: string | null;
  flaggedTitles: string[];
  recentDecisions: DecisionMemo[];
  /** The misconception the student just showed they've overcome, if any. */
  celebrate: Misconception | null;
  /** Mistakes made in the topic that was just finished, for the recap. */
  finishedTopicMistakes: { description: string; count: number; fixed: boolean }[];
}

export function responderMessages(ctx: ResponderContext): ChatMessage[] {
  const system = `You are Tara, a warm, encouraging maths tutor teaching an Indian Class 10 student (NCERT) through VOICE and a WHITEBOARD.

Output a single JSON object: {"speech": string, "board": BoardOp[]}.

speech — read aloud by text-to-speech:
- Plain spoken English. No LaTeX, no symbols like ^, /, *, √ or =. Say "x squared", "b squared minus 4 a c", "3 by 2", "equals".
- At most ${WORD_LIMIT[ctx.action]} words. Short sentences.
- The system will ask the next question itself right after your speech, so do NOT ask a question and do NOT end with one.
- Never reveal the answer to the upcoming question, and never use the upcoming question's equation as your example or work through it.
- Stay consistent with the decision you are given; it is final. Never call a wrong answer right or a right answer wrong.

board — a list of operations on the whiteboard:
- {"op":"write","id":"<short_snake_id>","kind":"math","content":"<KaTeX LaTeX>"} for equations and steps.
- {"op":"write","id":"<id>","kind":"text","content":"<plain text>"} for short labels.
- {"op":"highlight","id":"<existing or newly written id>","term":"<exact substring of that item's content>"} to point at a term or step you are talking about. Omit "term" to highlight the whole line. Highlight whenever your speech refers to something specific on the board.
- {"op":"clear"} only if the board is cluttered and you are starting a fresh explanation.
- At most 4 writes per turn. Keep each line short. Re-using an id overwrites that line.
- Highlight at most one or two things per turn: the one your speech is focusing on.
- The lines "title", "q_text" and "q_math" belong to the system (topic title and upcoming question). Never write them or copy them; you may highlight them.`;

  const parts: string[] = [];
  parts.push(`ACTION: ${ctx.action} — ${ACTION_BRIEF[ctx.action]}`);
  parts.push(`Why this action was chosen: ${ctx.decision.reason}`);

  if (ctx.previousSubconcept && ctx.previousSubconcept.id !== ctx.subconcept?.id) {
    parts.push(`Previous topic: ${ctx.previousSubconcept.title}`);
  }
  if (ctx.subconcept) {
    parts.push(
      `Current topic: ${ctx.subconcept.title}\nObjective: ${ctx.subconcept.objective}\nKey facts:\n${ctx.subconcept.keyFacts.map((f) => `- ${f}`).join("\n")}`,
    );
  }
  if (ctx.strategy && ["teach", "advance", "reteach", "move_on_flagged"].includes(ctx.action)) {
    parts.push(`Teaching strategy: ${ctx.strategy.name}\n${ctx.strategy.guidance}`);
  }
  if (ctx.answeredCheck && ctx.assessment) {
    const mis = ctx.previousSubconcept?.misconceptions.find((m) => m.id === ctx.assessment?.misconceptionId)
      ?? ctx.subconcept?.misconceptions.find((m) => m.id === ctx.assessment?.misconceptionId);
    parts.push(
      `Question the student just answered: ${ctx.answeredCheck.text} ${ctx.answeredCheck.math ?? ""}
Student said: "${ctx.studentText ?? ""}"
Graded: ${ctx.assessment.correct === null ? "not an answer" : ctx.assessment.correct ? "CORRECT" : "INCORRECT"}${mis ? `\nLikely misconception: ${mis.description}` : ""}${ctx.assessment.note ? `\nAssessor note: ${ctx.assessment.note}` : ""}
Worked solution of that question: ${ctx.answeredCheck.solution}`,
    );
  } else if (ctx.studentText) {
    parts.push(`Student said: "${ctx.studentText}"`);
  }
  if (ctx.pendingCheck) {
    parts.push(`Upcoming question (asked by the system after your speech — do not reveal its answer): ${ctx.pendingCheck.text} ${ctx.pendingCheck.math ?? ""}`);
  }
  if (ctx.celebrate) {
    parts.push(`Celebrate this specifically in one short sentence: the student just got right the kind of question they got wrong before (${ctx.celebrate.description}).`);
  }
  if (ctx.finishedTopicMistakes.length) {
    parts.push(
      `Mistakes in the finished topic (for the recap):\n${ctx.finishedTopicMistakes.map((m) => `- ${m.description} (${m.count}×${m.fixed ? ", later fixed" : ""})`).join("\n")}`,
    );
  }
  if (ctx.flaggedTitles.length) parts.push(`Topics flagged for review: ${ctx.flaggedTitles.join(", ")}`);
  if (ctx.recentDecisions.length) {
    parts.push(`Your recent decisions and their real reasons, oldest first (use these if the student asks why you did something):\n${ctx.recentDecisions.map((d) => `- ${d.action}: ${d.reason}`).join("\n")}`);
  }

  parts.push(
    `Current board (id: content):\n${ctx.board.length ? ctx.board.map((b) => `- ${b.id} [${b.kind}]: ${b.content}`).join("\n") : "(empty)"}`,
  );
  const recent = ctx.history.slice(-6).map((h) => `${h.role === "tutor" ? "Tara" : "Student"}: ${h.text}`).join("\n");
  parts.push(`Recent conversation:\n${recent || "(start of session)"}`);

  return [
    { role: "system", content: system },
    { role: "user", content: parts.join("\n\n") },
  ];
}
