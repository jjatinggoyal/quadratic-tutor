// Simulated students.
//
// An LLM asked to "play a weak student" still answers almost everything
// correctly. So behaviour is decided in code, turn by turn, from each
// persona's probabilities, and the student LLM is only asked to *voice* that
// behaviour naturally. Students also learn: the chance of a correct answer
// rises with each re-teach they receive on the current topic.

export type Directive = "correct" | "wrong" | "dont_know" | "question" | "off_topic";

export interface TurnContext {
  subconceptId: string;
  reteachesOnTopic: number;
  rng: () => number;
}

export interface Persona {
  id: string;
  summary: string;
  /** How this student talks, and what their wrong answers look like. */
  style: string;
  behave(ctx: TurnContext): Directive;
  /** Corrupts the reply the way speech recognition would. */
  channel?: (text: string, rng: () => number) => string;
}

function pick(rng: () => number, weights: Partial<Record<Directive, number>>): Directive {
  const entries = Object.entries(weights) as [Directive, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [d, w] of entries) if ((r -= w) <= 0) return d;
  return entries[entries.length - 1][0];
}

const learn = (base: number, ctx: TurnContext, perReteach = 0.2) => Math.min(0.95, base + perReteach * ctx.reteachesOnTopic);

export const personas: Persona[] = [
  {
    id: "quick_learner",
    summary: "Strong student; answers correctly and briefly.",
    style: "Confident and brief. Sometimes shows one line of working.",
    behave: (ctx) => pick(ctx.rng, { correct: 0.9, wrong: 0.1 }),
  },
  {
    id: "sign_slipper",
    summary: "Knows the methods but flips signs; improves once signs are explained.",
    style:
      "Knows the methods. When wrong, the mistake is always a SIGN error: roots of (x - 2)(x - 3) = 0 taken as -2 and -3, (-3)^2 taken as -9, -4ac not turned positive when c is negative, or a sign lost when moving a term across the equals sign.",
    behave: (ctx) => {
      const signHeavy = ["factorisation", "quadratic_formula", "discriminant"].includes(ctx.subconceptId);
      const p = learn(signHeavy ? 0.4 : 0.8, ctx, 0.3);
      return pick(ctx.rng, { correct: p, wrong: 1 - p });
    },
  },
  {
    id: "struggling",
    summary: "Low confidence; often doesn't know, asks basic questions, improves slowly.",
    style: 'Nervous and hesitant ("um", "maybe?"). Questions are basic ("what does root mean?", "why can\'t a be zero?"). Wrong answers are confused guesses.',
    behave: (ctx) => {
      const p = learn(0.25, ctx, 0.15);
      return pick(ctx.rng, { correct: p, wrong: 0.35, dont_know: 0.25, question: 0.15 });
    },
  },
  {
    id: "distracted",
    summary: "Average student who drifts off-topic about one turn in four.",
    style: "Casual. When off-topic, talks about cricket, a video game, lunch, or another subject's homework.",
    behave: (ctx) => {
      const p = learn(0.5, ctx);
      return pick(ctx.rng, { off_topic: 0.25, correct: p, wrong: Math.max(0.05, 0.75 - p) });
    },
  },
  {
    id: "hinglish",
    summary: "Answers in Hindi-English mix; average ability.",
    style:
      'Speaks Hinglish, mixing Hindi and English ("haan, x equals 3 hoga", "mujhe samajh nahi aaya", "ye quadratic nahi hai kyunki x square cancel ho jaata hai"). Says numbers in English.',
    behave: (ctx) => {
      const p = learn(0.55, ctx);
      return pick(ctx.rng, { correct: p, wrong: Math.max(0.05, 0.9 - p), dont_know: 0.1 });
    },
  },
  {
    id: "noisy_mic",
    summary: "Average student behind a bad microphone: speech-recognition errors on every reply.",
    style: 'Says numbers as words ("minus two and three").',
    behave: (ctx) => {
      const p = learn(0.6, ctx);
      return pick(ctx.rng, { correct: p, wrong: 1 - p });
    },
    channel: (text, rng) =>
      text
        .split(" ")
        .map((w) => {
          const lw = w.toLowerCase().replace(/[^a-z]/g, "");
          const r = rng();
          if (lw === "two" && r < 0.5) return "to";
          if (lw === "four" && r < 0.5) return "for";
          if (lw === "eight" && r < 0.3) return "ate";
          if (r < 0.05) return ""; // dropped word
          return w;
        })
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/[.,!?]/g, ""),
  },
];

export const DIRECTIVE_TEXT: Record<Directive, string> = {
  correct: "This turn, answer the tutor's question CORRECTLY (work it out carefully).",
  wrong: "This turn, answer the tutor's question INCORRECTLY, with a mistake typical of you. Do not say it might be wrong.",
  dont_know: "This turn, say you don't know or don't understand. Don't attempt an answer.",
  question: "This turn, don't answer; ask the tutor a short, genuine question about the current topic.",
  off_topic: "This turn, ignore the question and talk about something unrelated to maths.",
};
