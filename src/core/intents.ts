import type { Assessment, Curriculum } from "./types";

// Replies the engine can understand locally, without the assessor LLM. These
// rules only fire on short, unambiguous replies; anything else goes to the LLM.

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|third|minus|negative)\b/i;

// Explicit requests to hear the last turn again. A bare "again" is deliberately
// not enough: "two again" is an answer, "can I try again" is not a repeat request.
const REPEAT_RE = /\b(repeat|say (that|it|this) again|again please|once more|one more time|didn'?t (hear|catch)|come again|pardon|dobara|phir se)\b/i;
const SLOWER_RE = /\b(slow(er|ly)?|too fast|dheere)\b/i;

/** "Repeat that" / "slower please": replayed instantly with no LLM call. */
export function quickIntent(text: string): Assessment | null {
  const words = text.trim().split(/\s+/).length;
  if (words > 8 || /\d/.test(text) || NUMBER_WORDS.test(text) || /\b(explain|why|how|what|step|part|try|know)\b/i.test(text)) return null;
  const slower = SLOWER_RE.test(text);
  if (!slower && !REPEAT_RE.test(text)) return null;
  return { intent: "repeat", slower, extracted: null, misconceptionId: null, note: "matched a repeat request locally", correct: null, source: "heuristic" };
}

// Replying to "Ready to begin?". Asking to wait wins over anything else; a bare
// "no" counts only at the start of the reply ("no problem, let's go" is ready).
const WAIT_RE = /\b(not (yet|ready)|wait|hold on|one (sec|second|minute)|give me a (sec|second|minute|moment)|later|ruko|abhi nahi)\b/i;
const LEADING_NO_RE = /^\s*(no|nope|nah)\b(?!\s*(problem|worries|issue))/i;

export function isNotReady(text: string): boolean {
  if (text.trim().split(/\s+/).length > 8) return false;
  return WAIT_RE.test(text) || LEADING_NO_RE.test(text);
}

export function welcomeSpeech(c: Curriculum): string {
  return (
    `Hi, I'm Tara, your maths tutor! Today we're learning quadratic equations, in ${countWord(c.subconcepts.length)} short steps. You can see them on the left. ` +
    "For each one, I'll explain on the whiteboard, then ask you a quick question to check it made sense. " +
    "Answer by speaking or typing. You can stop me any time to ask a question, or say repeat. Ready to begin?"
  );
}

export function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}
