import { nearDuplicate } from "./mathcheck";
import type { BoardOp, CheckItem } from "./types";

// Guard against the most common pedagogical failure: teaching with the very
// question the student is about to be asked. Used as the responder's semantic
// validator, so a leaking reply is rejected and retried with feedback.

const normMath = (s: string) => s.replace(/\\[,;!]|\\quad|\s/g, "");

/**
 * Returns a description of the leak, or null. Only checked when the question is
 * new this turn: discussing a question that is already open is fine.
 */
export function leakProblem(lines: { kind: "text" | "math"; content: string }[], pending: CheckItem | null, previousCheckId: string | null): string | null {
  if (!pending || pending.id === previousCheckId) return null;
  const written = lines.map((l) => normMath(l.content));

  if (pending.math) {
    const target = normMath(pending.math.split("=")[0]);
    // Also catch scaled and sign-flipped copies; check each "=" equation within a line.
    const equations = lines
      .filter((l) => l.kind === "math")
      .flatMap((l) => l.content.split(/\\Rightarrow|\\quad|\\;|,|:/).filter((part) => part.includes("=")));
    if (written.some((w) => w.includes(target)) || equations.some((e) => nearDuplicate(e, pending.math!))) {
      return `the board uses the upcoming question's equation (${pending.math}) or a sign-flipped copy of it; use a clearly different example`;
    }
    return null;
  }

  // Word problems: the story's distinctive numbers (e.g. 306, 528) must not appear on the board.
  // Small numbers like 10 or 13 are too common in other examples to mean anything.
  const numbers = [...new Set(pending.text.match(/\d+/g) ?? [])].filter((n) => Number(n) > 20);
  const hit = numbers.find((n) => written.some((w) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(w)));
  return hit ? `the board works through the upcoming word problem (it uses ${hit}); use a different example` : null;
}

/** The lines a responder reply would put on the board. */
export function writtenLines(board: BoardOp[], solution: { kind: "text" | "math"; content: string }[]) {
  return [...board.flatMap((op) => (op.op === "write" ? [{ kind: op.kind, content: op.content }] : [])), ...solution];
}
