import { z } from "zod";

// Output contracts for the two LLM roles. Deliberately lenient on shape
// (models send numbers where we asked for strings, or null for empty arrays)
// but strict on meaning: an unknown intent or board op is a failed call.

const numberish = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

export const AssessorOutput = z.object({
  intent: z.enum(["answer", "dont_know", "question", "off_topic", "unclear"]),
  numbers: z.array(numberish).nullish().transform((v) => v ?? []),
  yes_no: z.boolean().nullish().transform((v) => v ?? null),
  choice: z.string().nullish().transform((v) => v ?? null),
  misconception: z.string().nullish().transform((v) => v ?? null),
  note: z.string().nullish().transform((v) => v ?? ""),
});
export type AssessorOutput = z.infer<typeof AssessorOutput>;

const BoardId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

export const BoardOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("write"), id: BoardId, kind: z.enum(["text", "math"]), content: z.string().min(1).max(300) }),
  z.object({ op: z.literal("highlight"), id: BoardId, term: z.string().max(120).nullish().transform((v) => v || undefined) }),
  z.object({ op: z.literal("clear") }),
]);

export const ResponderOutput = z.object({
  speech: z.string().min(1).max(1500),
  board: z.array(BoardOpSchema).max(8).nullish().transform((v) => v ?? []),
});
export type ResponderOutput = z.infer<typeof ResponderOutput>;
