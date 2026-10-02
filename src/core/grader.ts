import type { AnswerSpec, Assessment } from "./types";

// Deterministic grading. The LLM's only job is to *extract* what the student
// said into a structured value; whether that value is right is decided here,
// against the answer key in the curriculum.

/** Parse "3", "-1/2", "0.5", "3/2", "−2" (unicode minus) into a number. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!s) return null;
  const frac = s.match(/^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den === 0 ? null : Number(frac[1]) / den;
  }
  return /^[+-]?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

const EPS = 1e-6;
const close = (a: number, b: number, tol = EPS) => Math.abs(a - b) <= tol;

/** Compare as sets: duplicates collapse ("3 and 3" matches ["3"]). */
function sameNumberSet(given: number[], expected: number[]): boolean {
  const uniq = (xs: number[]) => xs.filter((x, i) => xs.findIndex((y) => close(x, y)) === i);
  const g = uniq(given);
  const e = uniq(expected);
  return g.length === e.length && e.every((x) => g.some((y) => close(x, y)));
}

export function grade(spec: AnswerSpec, extracted: Assessment["extracted"]): boolean {
  if (!extracted) return false;
  switch (spec.type) {
    case "number_set": {
      const nums = (extracted.numbers ?? []).map(parseNumber);
      if (nums.length === 0 || nums.some((n) => n === null)) return false;
      const expected = spec.values.map((v) => parseNumber(v)!);
      return sameNumberSet(nums as number[], expected);
    }
    case "number": {
      const nums = (extracted.numbers ?? []).map(parseNumber).filter((n): n is number => n !== null);
      // A single number is expected; "16 metres" arrives as ["16"]. Several different numbers is a hedge, not an answer.
      const uniq = nums.filter((x, i) => nums.findIndex((y) => close(x, y)) === i);
      return uniq.length === 1 && close(uniq[0], parseNumber(spec.value)!, spec.tolerance ?? EPS);
    }
    case "yes_no":
      return extracted.yesNo === spec.value;
    case "choice":
      return extracted.choice === spec.value;
  }
}

/** Human-readable answer key, used in decision reasons and prompts. */
export function describeAnswer(spec: AnswerSpec): string {
  switch (spec.type) {
    case "number_set":
      return spec.values.join(", ");
    case "number":
      return spec.value;
    case "yes_no":
      return spec.value ? "yes" : "no";
    case "choice":
      return spec.options.find((o) => o.id === spec.value)?.label ?? spec.value;
  }
}

export function describeExtracted(extracted: Assessment["extracted"]): string {
  if (!extracted) return "(nothing)";
  if (extracted.numbers?.length) return extracted.numbers.join(", ");
  if (extracted.yesNo !== undefined && extracted.yesNo !== null) return extracted.yesNo ? "yes" : "no";
  if (extracted.choice) return extracted.choice.replace(/_/g, " ");
  return "(nothing)";
}

// ---------------------------------------------------------------------------
// Heuristic extraction, used only when the LLM assessor is unavailable.
// It understands the common spoken forms ("minus two and three", "x equals
// half", "yes it is") well enough to keep the loop moving in a degraded mode.

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
};

export function heuristicExtract(spec: AnswerSpec, text: string): Assessment {
  const t = ` ${text.toLowerCase().replace(/[−–]/g, "-")} `;
  const base = { misconceptionId: null, note: "heuristic extraction (LLM unavailable)", source: "heuristic" as const };

  if (/\b(don'?t know|no idea|not sure|pata nahi|idk)\b/.test(t)) {
    return { ...base, intent: "dont_know", extracted: null, correct: null };
  }

  if (spec.type === "yes_no") {
    const yes = /\b(yes|yeah|yep|haan|it is|correct|true)\b/.test(t);
    const no = /\b(no|nope|nahi|not|isn'?t|false)\b/.test(t);
    if (yes === no) return { ...base, intent: "unclear", extracted: null, correct: null };
    return { ...base, intent: "answer", extracted: { yesNo: yes }, correct: null };
  }

  if (spec.type === "choice") {
    const choice = /\bno real|not real|imaginary|none\b/.test(t)
      ? "no_real"
      : /\bequal|same|repeated|one root\b/.test(t)
        ? "two_equal"
        : /\bdistinct|different|two real|two roots\b/.test(t)
          ? "two_distinct"
          : null;
    return choice
      ? { ...base, intent: "answer", extracted: { choice }, correct: null }
      : { ...base, intent: "unclear", extracted: null, correct: null };
  }

  const numbers = spokenNumbers(t);
  return numbers.length
    ? { ...base, intent: "answer", extracted: { numbers }, correct: null }
    : { ...base, intent: "unclear", extracted: null, correct: null };
}

function spokenNumbers(t: string): string[] {
  const out: string[] = [];
  const tokens = t
    .replace(/([0-9])\s*\/\s*([0-9])/g, "$1/$2")
    .replace(/\bby\b|\bover\b/g, "/")
    .split(/[\s,;]+|(?<=\d)(?=[a-z])/)
    .filter(Boolean);
  let sign = 1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "minus" || tok === "negative") { sign = -1; continue; }
    if (tok === "half" && (i === 0 || !/^\d|^(one|a)$/.test(tokens[i - 1]))) { out.push(sign < 0 ? "-1/2" : "1/2"); sign = 1; continue; }
    let n: string | null = null;
    if (/^[+-]?\d+(?:\.\d+)?(?:\/\d+)?$/.test(tok)) n = tok;
    else if (tok in WORDS) n = String(WORDS[tok]);
    if (n === null) continue;
    // "one by two", "3 / 2", "two thirds"
    if (tokens[i + 1] === "/" && tokens[i + 2] !== undefined) {
      const den = /^\d+$/.test(tokens[i + 2]) ? tokens[i + 2] : WORDS[tokens[i + 2]]?.toString();
      if (den) { n = `${n}/${den}`; i += 2; }
    } else if (tokens[i + 1] && /^(half|halves|third|thirds|quarter|quarters)$/.test(tokens[i + 1])) {
      const den = tokens[i + 1].startsWith("half") ? 2 : tokens[i + 1].startsWith("third") ? 3 : 4;
      n = `${n}/${den}`; i += 1;
    }
    out.push(sign < 0 && !n.startsWith("-") ? `-${n}` : n);
    sign = 1;
  }
  return out;
}
