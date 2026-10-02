import katex from "katex";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { quadratics } from "../src/core/curriculum/quadratics";
import { runTurn, type EngineDeps } from "../src/core/engine";
import { describeAnswer } from "../src/core/grader";
import { callJson, resetBreakers } from "../src/core/llm";
import { getCheck, getSubconcept } from "../src/core/policy";
import { PROMPT_VERSION } from "../src/core/prompts";
import type { TurnResult } from "../src/core/types";
import { loadEnv, nodeDeps } from "../scripts/env";
import { lintCurriculum } from "./lint";
import { scenarios, type Scenario } from "./scenarios";

// Usage:
//   npm run eval                          # all scenarios, compare to baseline
//   npm run eval -- --only sign-error-reteach,off-topic --runs 5
//   npm run eval -- --update-baseline     # accept current results as the baseline
//   MODEL_RESPONDER=google/gemini-3.1-flash-lite npm run eval   # try a model change
//
// Each LLM scenario runs N times (default 3) and passes if at least 2/3 of runs
// pass every check. The suite fails (exit 1) if any scenario that passes in
// evals/baseline.json now fails — i.e. on regressions.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const RUNS = Number(opt("runs") ?? 3);
const ONLY = opt("only")?.split(",");
const CONCURRENCY = 4;
const BASELINE = new URL("./baseline.json", import.meta.url);
const JUDGE_MODEL = loadEnv().JUDGE_MODEL ?? "openai/gpt-5.4";

interface RunOutcome {
  ok: boolean;
  failures: string[];
  action: string;
  speech: string;
  totalMs: number;
}
interface ScenarioOutcome {
  id: string;
  catches: string;
  passedRuns: number;
  runs: number;
  pass: boolean;
  runsDetail: RunOutcome[];
}

const { transport: realTransport, models } = nodeDeps();

async function runOnce(s: Scenario): Promise<RunOutcome> {
  resetBreakers(); // scenarios must not affect each other through the circuit breaker
  const deps: EngineDeps = {
    curriculum: quadratics,
    transport: s.transport ? s.transport(realTransport, models) : realTransport,
    models,
    ...(s.timeouts ? { timeouts: s.timeouts } : {}),
  };
  const before = s.state();
  const r = await runTurn(deps, before, s.history ?? [], s.student);
  const failures = [...deterministicChecks(s, before, r)];
  if (s.expect.judge?.length && failures.length === 0) failures.push(...(await judge(s, before, r)));
  return { ok: failures.length === 0, failures, action: r.decision.action, speech: r.speech, totalMs: r.telemetry.totalMs };
}

function deterministicChecks(s: Scenario, before: ReturnType<Scenario["state"]>, r: TurnResult): string[] {
  const e = s.expect;
  const f: string[] = [];
  const a = r.assessment;
  if (e.intent && a?.intent !== e.intent) f.push(`intent: expected ${e.intent}, got ${a?.intent}`);
  if (e.correct !== undefined && a?.correct !== e.correct) f.push(`correct: expected ${e.correct}, got ${a?.correct} (extracted ${JSON.stringify(a?.extracted)})`);
  if (e.action && r.decision.action !== e.action) f.push(`action: expected ${e.action}, got ${r.decision.action}`);
  if (e.misconception && !e.misconception.includes(a?.misconceptionId ?? "")) f.push(`misconception: expected one of ${e.misconception.join("/")}, got ${a?.misconceptionId}`);
  if (e.nextSubconcept !== undefined && r.state.subconceptId !== e.nextSubconcept) f.push(`next subconcept: expected ${e.nextSubconcept}, got ${r.state.subconceptId}`);
  if (e.pendingUnchanged && r.state.pendingCheckId !== before.pendingCheckId) f.push(`pending question changed (${before.pendingCheckId} → ${r.state.pendingCheckId})`);
  for (const [id, status] of Object.entries(e.statusAfter ?? {})) {
    if (r.state.progress[id]?.status !== status) f.push(`status of ${id}: expected ${status}, got ${r.state.progress[id]?.status}`);
  }
  if (e.degraded !== undefined && r.telemetry.degraded !== e.degraded) f.push(`degraded: expected ${e.degraded}, got ${r.telemetry.degraded}`);
  if (e.maxTotalMs && r.telemetry.totalMs > e.maxTotalMs) f.push(`too slow: ${r.telemetry.totalMs}ms > ${e.maxTotalMs}ms`);
  if (e.custom) {
    const msg = e.custom(r, before);
    if (msg) f.push(msg);
  }
  if (e.board) {
    const msg = e.board(r.board);
    if (msg) f.push(`board: ${msg}`);
  }

  // Invariants that hold for every turn.
  if (!r.speech.trim()) f.push("empty speech");
  if (/[\\^$]/.test(r.speech)) f.push(`LaTeX leaked into speech: "${r.speech.slice(0, 80)}"`);
  for (const re of e.speechMust ?? []) if (!re.test(r.speech)) f.push(`speech missing ${re}`);
  for (const re of e.speechMustNot ?? []) if (re.test(r.speech)) f.push(`speech contains forbidden ${re}`);
  const pending = getCheck(getSubconcept(quadratics, r.state.subconceptId), r.state.pendingCheckId);
  let llmPart = r.speech;
  if (pending && r.decision.action !== "complete" && r.decision.action !== "repeat") {
    if (!r.speech.endsWith(pending.spoken)) f.push("speech does not end by asking the pending question");
    llmPart = r.speech.slice(0, r.speech.lastIndexOf(pending.spoken));
  }
  const words = llmPart.split(/\s+/).filter(Boolean).length;
  const maxWords = e.maxWords ?? 140;
  if (words > maxWords) f.push(`too long: ${words} words > ${maxWords}`);
  for (const item of r.board) {
    if (item.kind !== "math") continue;
    try {
      katex.renderToString(item.content, { throwOnError: true, strict: false });
    } catch (err) {
      f.push(`board line "${item.id}" is invalid LaTeX: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  return f;
}

const JudgeOutput = z.object({
  results: z.array(z.object({ criterion: z.string(), pass: z.boolean(), reason: z.string() })),
});

async function judge(s: Scenario, before: ReturnType<Scenario["state"]>, r: TurnResult): Promise<string[]> {
  const sub = getSubconcept(quadratics, before.subconceptId)!;
  const asked = getCheck(sub, before.pendingCheckId)!;
  const pending = getCheck(getSubconcept(quadratics, r.state.subconceptId), r.state.pendingCheckId);
  const criteria = [...(s.expect.judge ?? [])];
  if (pending && pending.id !== asked.id) {
    criteria.push(`Does not reveal the answer to the upcoming question (${pending.text} ${pending.math ?? ""}; its answer is ${describeAnswer(pending.answer)}). The system asks that question at the end; the tutor must not answer it.`);
  }
  const { value, telemetry } = await callJson({
    role: "responder",
    transport: realTransport,
    models: [JUDGE_MODEL, JUDGE_MODEL],
    maxTokens: 2000,
    temperature: 0,
    timeoutMs: 30_000,
    budgetMs: 60_000,
    schema: JudgeOutput,
    messages: [
      {
        role: "system",
        content:
          'You are grading one turn of an AI maths tutor for Indian Class 10 students. Judge strictly but fairly, only against the listed criteria. Note: the system always appends the pending question at the end of the tutor reply ("So, back to our question…" / "Now, your turn…"); that is expected and must not count against any criterion. Respond as JSON: {"results":[{"criterion": string, "pass": boolean, "reason": string}]} with one entry per criterion, in order.',
      },
      {
        role: "user",
        content: `Topic: ${sub.title}
Question the tutor had asked: ${asked.text} ${asked.math ?? ""} (answer: ${describeAnswer(asked.answer)})
Student said: "${s.student}"
System grading: ${r.assessment?.correct === null ? "not an answer" : r.assessment?.correct ? "correct" : "incorrect"}; decided action: ${r.decision.action}

Tutor's spoken reply:
"""${r.speech}"""

Tutor's whiteboard after the turn:
${r.board.map((b) => `- ${b.content}`).join("\n")}

Criteria:
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
      },
    ],
  });
  if (!value) return [`judge unavailable: ${telemetry.attempts.map((x) => x.error).join(" | ")}`];
  return value.results.filter((x) => !x.pass).map((x) => `judge: ${x.criterion} — ${x.reason}`);
}

// ---------------------------------------------------------------------------

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const lint = lintCurriculum();
  if (lint.length) {
    console.log(`Curriculum lint failed:\n${lint.map((e) => `  ✗ ${e}`).join("\n")}`);
    process.exit(1);
  }
  const selected = scenarios.filter((s) => !ONLY || ONLY.includes(s.id));
  console.log(`Evals: ${selected.length} scenarios · prompt ${PROMPT_VERSION} · assessor ${models.assessor} · responder ${models.responder} · fallback ${models.fallback} · judge ${JUDGE_MODEL}\n`);

  const jobs = selected.flatMap((s) => Array.from({ length: s.transport && !s.id.includes("outage") ? 1 : RUNS }, () => s));
  const t0 = Date.now();
  const results = await pool(jobs, CONCURRENCY, async (s) => ({ id: s.id, run: await runOnce(s).catch((err) => ({ ok: false, failures: [`crashed: ${err}`], action: "-", speech: "", totalMs: 0 })) }));

  const outcomes: ScenarioOutcome[] = selected.map((s) => {
    const runsDetail = results.filter((r) => r.id === s.id).map((r) => r.run);
    const passedRuns = runsDetail.filter((r) => r.ok).length;
    return { id: s.id, catches: s.catches, passedRuns, runs: runsDetail.length, pass: passedRuns / runsDetail.length >= 2 / 3, runsDetail };
  });

  const baseline: Record<string, boolean> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).scenarios : {};
  let regressions = 0;
  for (const o of outcomes) {
    const was = baseline[o.id];
    const tag = o.pass ? (was === false ? "NEW PASS" : "pass") : was === true ? "REGRESSION" : "fail";
    if (tag === "REGRESSION") regressions++;
    console.log(`${o.pass ? "✓" : "✗"} ${o.id.padEnd(32)} ${`${o.passedRuns}/${o.runs}`.padEnd(5)} ${tag}`);
    if (!o.pass || flag("verbose")) {
      const seen = new Set<string>();
      for (const run of o.runsDetail) for (const fl of run.failures) if (!seen.has(fl)) (seen.add(fl), console.log(`    - ${fl}`));
      if (flag("verbose")) console.log(`    speech: ${o.runsDetail[0]?.speech}`);
    }
  }
  const passed = outcomes.filter((o) => o.pass).length;
  console.log(`\n${passed}/${outcomes.length} scenarios passed in ${((Date.now() - t0) / 1000).toFixed(0)}s. ${regressions} regression(s) vs baseline.`);

  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ promptVersion: PROMPT_VERSION, models, judge: JUDGE_MODEL, runs: RUNS, outcomes }, null, 2));
  console.log(`Details: ${file.pathname}`);

  if (flag("update-baseline")) {
    writeFileSync(BASELINE, JSON.stringify({ promptVersion: PROMPT_VERSION, models, updatedAt: new Date().toISOString(), scenarios: Object.fromEntries(outcomes.map((o) => [o.id, o.pass])) }, null, 2) + "\n");
    console.log("Baseline updated.");
  } else if (regressions > 0 || (!existsSync(BASELINE) && passed < outcomes.length)) {
    process.exit(1);
  }
}

await main();
