import { z } from "zod";
import { callJson, type LlmTransport } from "../core/llm";

// Server-side speech-to-text for browsers without the Web Speech API
// (e.g. Firefox). The browser records, converts to 16 kHz mono WAV, and posts
// base64. An audio-capable LLM on OpenRouter transcribes it.

const SttOutput = z.object({ text: z.string() });

export async function transcribe(transport: LlmTransport, models: string[], wavBase64: string) {
  const { value, telemetry } = await callJson({
    role: "assessor",
    transport,
    models,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: 'Transcribe this recording of an Indian school student speaking during a maths lesson. Write exactly what they say; use digits for numbers and "minus" for negatives as spoken. If there is no speech, return an empty string. Respond as JSON: {"text": "..."}',
          },
          { type: "input_audio", input_audio: { data: wavBase64, format: "wav" } },
        ],
      },
    ],
    schema: SttOutput,
    maxTokens: 200,
    temperature: 0,
    timeoutMs: 8000,
    budgetMs: 12000,
  });
  return { text: value ? value.text.trim() : null, ms: telemetry.ms, attempts: telemetry.attempts };
}
