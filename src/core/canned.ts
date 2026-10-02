import { describeAnswer } from "./grader";
import { countWord, welcomeSpeech } from "./intents";
import type { ResponderContext } from "./prompts";
import type { BoardOp, Curriculum } from "./types";

// Canned responses: the tutor keeps teaching from curriculum scripts when every
// LLM is unavailable. Less personal, still correct. The turn is marked degraded.

export interface ResponderReply {
  speech: string;
  board: BoardOp[];
  solution: { kind: "text" | "math"; content: string }[];
}

export function cannedResponse(c: Curriculum, ctx: ResponderContext): ResponderReply {
  const script = ctx.strategy?.fallback;
  const scriptOps: BoardOp[] = (script?.board ?? []).map((b, i) => ({ op: "write", id: `fb_${i + 1}`, kind: b.kind, content: b.content }));
  const missed = ctx.answeredCheck ? ` The answer was ${describeAnswer(ctx.answeredCheck.answer)}.` : "";
  const reply = (speech: string, board: BoardOp[] = []): ResponderReply => ({ speech, board, solution: [] });

  switch (ctx.action) {
    case "teach":
      return reply(script?.speech ?? "", scriptOps);
    case "advance":
      return reply(`That's right, well done. You've got this topic. Next: ${ctx.subconcept?.title}. ${script?.speech ?? ""}`, scriptOps);
    case "reteach":
      return reply(`Not quite.${missed} Let's look at it another way. ${script?.speech ?? ""}`, scriptOps);
    case "move_on_flagged":
      return reply(`That one is tricky.${missed} We'll come back to it later. Next: ${ctx.subconcept?.title}. ${script?.speech ?? ""}`, scriptOps);
    case "next_check":
      return reply("That's right, well done.");
    case "answer_question":
      return reply("Good question. Let's keep going, and I'll explain more as we work through it.");
    case "redirect":
      return reply("Let's get back to our maths.");
    case "clarify":
      return reply("Sorry, I didn't catch that. Could you say your answer again?");
    case "complete":
      return reply(`Congratulations! You've worked through all ${countWord(c.subconcepts.length)} topics on quadratic equations.`);
    case "review":
      return reply(`Welcome back! Let's start with a quick warm-up from ${ctx.subconcept?.title.toLowerCase() ?? "last time"}, to check it stuck.`);
    case "greet":
      return reply(welcomeSpeech(c));
    case "repeat":
    case "resume":
      return reply(""); // handled without the responder
  }
}
