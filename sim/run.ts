import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { quadratics } from "../src/core/curriculum/quadratics";
import { initialState, openingTurn, runTurn, type EngineDeps } from "../src/core/engine";
import { grade } from "../src/core/grader";
import { callJson } from "../src/core/llm";
import { getCheck, getSubconcept } from "../src/core/policy";
import type { HistoryLine } from "../src/core/prompts";
import type { CheckItem, TurnResult } from "../src/core/types";
import { loadEnv, nodeDeps } from "../scripts/env";
import { DIRECTIVE_TEXT, personas, type Directive, type Persona } from "./personas";

// Simulated sessions: an LLM plays the student, the real engine plays the tutor.
//
//   npm run sim                                  # all personas, 30 turns each
//   npm run sim -- --personas sign_slipper,struggling --turns 40
//
// Writes a JSON log + a readable Markdown transcript per session to sim/out/,
// and prints a summary table. Useful for spotting loop pathologies (e.g. a
// persona that never gets past a topic) that single-turn evals can't see.

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const MAX_TURNS = Number(opt("turns") ?? 30);
const SELECTED = opt("personas")?.split(",");
const STUDENT_MODEL = loadEnv().STUDENT_MODEL ?? "openai/gpt-5.4-mini";

const StudentReply = z.object({ reply: z.string().min(1), my_answer: z.string().nullish() });

function answerFormat(check: CheckItem | null): string {
  if (!check) return "null";
  const a = check.answer;
  if (a.type === "number_set" || a.type === "number") return 'the number(s) you gave, comma-separated, as digits or fractions like "3, -1/2"';
  if (a.type === "yes_no") return '"yes" or "no"';
  return `one of ${a.options.map((o) => `"${o.id}"`).join(", ")}`;
}

const STUDENT_SYSTEM = (p: Persona, directive: Directive, check: CheckItem | null) => `You are role-playing a Class 10 student in India talking to a voice maths tutor about quadratic equations.
Reply with ONLY what the student says out loud: one or two short spoken sentences, no LaTeX, no symbols (say "x squared", "minus 3").
Never break character or mention being an AI.
Your character: ${p.style}
${DIRECTIVE_TEXT[directive]}
Respond as JSON: {"reply": "...", "my_answer": ...} where my_answer is the final answer your reply gives (${answerFormat(check)}), or null if your reply gives no final answer.`;

/** Ground truth for grading accuracy: grade what the simulated student says it answered. */
function truth(check: CheckItem | null, myAnswer: string | null | undefined): boolean | null {
  if (!check || !myAnswer) return null;
  const a = check.answer;
  const extracted =
    a.type === "yes_no"
      ? { yesNo: /^y/i.test(myAnswer.trim()) }
      : a.type === "choice"
        ? { choice: myAnswer.trim() }
        : { numbers: myAnswer.split(/[,;]| and /).map((x) => x.trim()).filter(Boolean) };
  return grade(a, extracted);
}

function seededRng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

interface SimTurn {
  directive: Directive | null;
  truth: boolean | null; // is the student's own stated answer correct?
  student: string | null;
  heardAs: string | null;
  result: TurnResult;
}

async function simulate(p: Persona, deps: EngineDeps) {
  const rng = seededRng(42);
  const history: HistoryLine[] = [];
  const turns: SimTurn[] = [];
  let state = initialState(quadratics);

  const first = await openingTurn(deps, state, history);
  turns.push({ directive: null, truth: null, student: null, heardAs: null, result: first });
  state = first.state;
  history.push({ role: "tutor", text: first.speech });

  for (let i = 0; i < MAX_TURNS && state.subconceptId; i++) {
    const board = state.board.map((b) => `- ${b.content}`).join("\n");
    const sub = state.subconceptId;
    const check = getCheck(getSubconcept(quadratics, sub), state.pendingCheckId);
    const directive = p.behave({ subconceptId: sub, reteachesOnTopic: state.progress[sub]?.reteachCount ?? 0, rng });
    const { value } = await callJson({
      role: "responder",
      transport: deps.transport,
      models: [STUDENT_MODEL, STUDENT_MODEL],
      schema: StudentReply,
      maxTokens: 150,
      temperature: 0.9,
      timeoutMs: 15000,
      budgetMs: 30000,
      messages: [
        { role: "system", content: STUDENT_SYSTEM(p, directive, check) },
        {
          role: "user",
          content: `Whiteboard:\n${board}\n\nConversation so far:\n${history
            .slice(-8)
            .map((h) => `${h.role === "tutor" ? "Tutor" : "You"}: ${h.text}`)
            .join("\n")}\n\nWhat do you say now?`,
        },
      ],
    });
    const said = value?.reply ?? "sorry, can you repeat that?";
    const heard = p.channel ? p.channel(said, rng) : said;
    history.push({ role: "student", text: heard });
    const r = await runTurn(deps, state, history.slice(0, -1), heard);
    turns.push({ directive, truth: truth(check, value?.my_answer), student: said, heardAs: heard !== said ? heard : null, result: r });
    state = r.state;
    history.push({ role: "tutor", text: r.speech });
  }
  return { turns, state };
}

function transcript(p: Persona, turns: SimTurn[]): string {
  const lines = [`# Simulated session: ${p.id}`, ``, `> ${p.summary}`, ``];
  for (const [i, t] of turns.entries()) {
    if (t.student) lines.push(`**Student** _[${t.directive}${t.truth === null ? "" : t.truth ? ", actually right" : ", actually wrong"}]_: ${t.student}${t.heardAs ? `  \n_(heard as: "${t.heardAs}")_` : ""}`, ``);
    const d = t.result.decision;
    const a = t.result.assessment;
    lines.push(
      `> **${d.action}**${a?.correct === true ? " ✓" : a?.correct === false ? " ✗" : ""}${t.result.telemetry.degraded ? " (degraded)" : ""} · ${t.result.telemetry.totalMs} ms — ${d.reason}`,
      ``,
      `**Tutor (${i}):** ${t.result.speech}`,
      ``,
    );
  }
  return lines.join("\n");
}

function summarise(p: Persona, turns: SimTurn[], finalState: ReturnType<typeof initialState>) {
  const statuses = Object.values(finalState.progress);
  const ms = turns.map((t) => t.result.telemetry.totalMs).sort((a, b) => a - b);
  const count = (action: string) => turns.filter((t) => t.result.decision.action === action).length;
  return {
    persona: p.id,
    turns: turns.length - 1,
    mastered: statuses.filter((s) => s.status === "mastered").length,
    flagged: statuses.filter((s) => s.status === "needs_review").length,
    reteach: count("reteach"),
    questions: count("answer_question"),
    redirects: count("redirect") + count("clarify"),
    degraded: turns.filter((t) => t.result.telemetry.degraded).length,
    // Of the turns where the student gave an answer, how often the tutor graded it the same way as the answer key.
    gradedRight: pct(answered(turns).filter((t) => t.result.assessment?.intent === "answer" && t.result.assessment.correct === t.truth).length, answered(turns).length),
    // How often the simulated student actually did what its persona asked (a check on the simulator itself).
    obeyed: pct(turns.filter((t) => t.directive).filter((t) => agrees(t.directive!, t.result)).length, turns.length - 1),
    p50ms: ms[Math.floor(ms.length / 2)],
    p90ms: ms[Math.floor(ms.length * 0.9)],
    complete: finalState.subconceptId === null,
  };
}

const answered = (turns: SimTurn[]) => turns.filter((t) => t.truth !== null);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

function agrees(d: Directive, r: TurnResult): boolean {
  const a = r.assessment;
  if (!a) return false;
  switch (d) {
    case "correct":
      return a.intent === "answer" && a.correct === true;
    case "wrong":
      return a.intent === "answer" && a.correct === false;
    case "dont_know":
      return a.intent === "dont_know";
    case "question":
      return a.intent === "question";
    case "off_topic":
      return a.intent === "off_topic";
  }
}

async function main() {
  const { transport, models } = nodeDeps();
  const deps: EngineDeps = { curriculum: quadratics, transport, models };
  const chosen = personas.filter((p) => !SELECTED || SELECTED.includes(p.id));
  console.log(`Simulating ${chosen.map((p) => p.id).join(", ")} · up to ${MAX_TURNS} turns · student ${STUDENT_MODEL} · tutor ${models.responder}\n`);

  const outDir = new URL("./out/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const summaries = await Promise.all(
    chosen.map(async (p) => {
      const { turns, state } = await simulate(p, deps);
      writeFileSync(new URL(`${p.id}-${stamp}.md`, outDir), transcript(p, turns));
      writeFileSync(new URL(`${p.id}-${stamp}.json`, outDir), JSON.stringify({ persona: p.id, models, turns }, null, 2));
      return summarise(p, turns, state);
    }),
  );
  console.table(summaries);
  console.log(`Transcripts in ${outDir.pathname}`);
}

await main();
