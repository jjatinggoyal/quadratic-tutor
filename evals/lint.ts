import { quadratics } from "../src/core/curriculum/quadratics";
import { parseNumber } from "../src/core/grader";
import { equationFn, quadraticCoefficients } from "../src/core/mathcheck";
import type { CheckItem, Curriculum } from "../src/core/types";

// Static checks on the curriculum. Runs before the evals (and standalone via
// `npm run lint:curriculum`). A wrong answer key is the worst bug a tutor can
// have, so every machine-checkable key is verified by evaluating the equation.

const evalAt = (f: (x: number) => number, x: number) => f(x);
const coefficients = quadraticCoefficients;

const norm = (s: string) => s.replace(/\\[,;!]|\\quad|\s/g, "").replace(/\\dfrac|\\tfrac/g, "\\frac");
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function checkKey(check: CheckItem): string | null {
  const f = check.math ? equationFn(check.math) : null;
  const spec = check.answer;

  if (spec.type === "number_set" && f) {
    for (const v of spec.values) {
      const x = parseNumber(v);
      if (x === null) return `unparseable value ${v}`;
      if (!close(evalAt(f, x), 0)) return `claimed root ${v} gives ${evalAt(f, x)} ≠ 0`;
    }
    const { a, b, c } = coefficients(f);
    const d = b * b - 4 * a * c;
    const expectedCount = d > 1e-9 ? 2 : close(d, 0) ? 1 : 0;
    if (new Set(spec.values.map((v) => parseNumber(v))).size !== expectedCount) return `expected ${expectedCount} distinct root(s), key lists ${spec.values.length}`;
  }
  if (spec.type === "yes_no" && f && check.id.startsWith("rt_")) {
    const m = check.text.match(/x = ([−-]?\d+(?:\/\d+)?)/);
    const x = m ? parseNumber(m[1]) : null;
    if (x === null) return "couldn't read the candidate root from the text";
    if (close(evalAt(f, x), 0) !== spec.value) return `substituting x = ${m![1]} gives ${evalAt(f, x)}, key says ${spec.value ? "yes" : "no"}`;
  }
  if (spec.type === "yes_no" && f && check.id.startsWith("sf_")) {
    const { a, b, c } = coefficients(f);
    const residual = evalAt(f, 2) - (4 * a + 2 * b + c); // non-zero if the degree is above 2
    const isQuadratic = !close(a, 0) && close(residual, 0);
    if (isQuadratic !== spec.value) return `equation is ${isQuadratic ? "" : "not "}quadratic, key says ${spec.value ? "yes" : "no"}`;
  }
  if (spec.type === "choice" && f) {
    const { a, b, c } = coefficients(f);
    const d = b * b - 4 * a * c;
    const nature = d > 1e-9 ? "two_distinct" : close(d, 0) ? "two_equal" : "no_real";
    if (nature !== spec.value) return `D = ${d} means ${nature}, key says ${spec.value}`;
  }
  if (spec.type === "number" && f && check.id.startsWith("dc_")) {
    const { a, b, c } = coefficients(f);
    if (!close(b * b - 4 * a * c, parseNumber(spec.value)!)) return `D = ${b * b - 4 * a * c}, key says ${spec.value}`;
  }
  return null;
}

export function lintCurriculum(c: Curriculum = quadratics): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const sub of c.subconcepts) {
    if (ids.has(sub.id)) errors.push(`duplicate subconcept id ${sub.id}`);
    ids.add(sub.id);
    if (sub.strategies.length < 2) errors.push(`${sub.id}: needs at least 2 strategies to re-teach differently`);
    const needed = sub.mastery.correctInARow + sub.mastery.maxReteaches;
    if (sub.checks.length < needed + 1) errors.push(`${sub.id}: ${sub.checks.length} checks, but a student can use up to ${needed} before moving on; add more`);

    const checkIds = new Set<string>();
    for (const q of sub.checks) {
      if (checkIds.has(q.id)) errors.push(`${sub.id}: duplicate check id ${q.id}`);
      checkIds.add(q.id);
      const keyError = checkKey(q);
      if (keyError) errors.push(`${sub.id}/${q.id}: answer key wrong? ${keyError}`);
      if (q.math && !equationFn(q.math) && q.answer.type !== "number") errors.push(`${sub.id}/${q.id}: couldn't parse equation to verify the key`);
    }

    for (const m of sub.misconceptions) {
      if (!sub.strategies.some((st) => st.targets.includes(m.id))) errors.push(`${sub.id}: no strategy targets misconception ${m.id}`);
    }
    for (const st of sub.strategies) {
      for (const t of st.targets) if (!sub.misconceptions.some((m) => m.id === t)) errors.push(`${sub.id}/${st.id}: targets unknown misconception ${t}`);
    }

    // Teaching material must never contain a check's equation: that would give the answer away.
    for (const st of sub.strategies) {
      const material = [st.guidance, st.fallback.speech, ...st.fallback.board.map((b) => b.content)].map(norm).join(" | ");
      for (const q of sub.checks) {
        if (q.math && material.includes(norm(q.math))) errors.push(`${sub.id}/${st.id}: teaching material uses the equation of check ${q.id}`);
      }
    }
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = lintCurriculum();
  for (const e of errors) console.log(`✗ ${e}`);
  console.log(errors.length ? `\n${errors.length} curriculum problem(s).` : `✓ curriculum OK (${quadratics.subconcepts.length} subconcepts, ${quadratics.subconcepts.reduce((n, s) => n + s.checks.length, 0)} checks, every key verified)`);
  process.exit(errors.length ? 1 : 0);
}
