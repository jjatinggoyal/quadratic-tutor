import { z } from "zod";
import { callJson, type LlmTransport } from "../core/llm";

// Server-side speech-to-text for browsers without the Web Speech API
// (e.g. Firefox). The browser records, converts to 16 kHz mono WAV, and posts
// base64.
//
//   1. Groq Whisper (whisper-large-v3-turbo): purpose-built STT, ~0.3 s.
//   2. Fallback: an audio-capable LLM on OpenRouter, ~2 s.

const SttOutput = z.object({ text: z.string() });

// Whisper's prompt biases spelling and vocabulary toward the lesson.
const WHISPER_PROMPT = "A Class 10 student answering a maths question about quadratic equations: x squared, minus 4, 3 by 2, discriminant, roots.";

export async function transcribe(groqKey: string | null, transport: LlmTransport, llmModels: string[], wavBase64: string) {
  const started = Date.now();
  const attempts: { model: string; ok: boolean; ms: number; error?: string }[] = [];

  if (groqKey) {
    const t0 = Date.now();
    try {
      const text = await groqWhisper(groqKey, wavBase64);
      attempts.push({ model: "groq:whisper-large-v3-turbo", ok: true, ms: Date.now() - t0 });
      return { text, ms: Date.now() - started, via: "groq-whisper", attempts };
    } catch (err) {
      attempts.push({ model: "groq:whisper-large-v3-turbo", ok: false, ms: Date.now() - t0, error: String(err).slice(0, 200) });
    }
  }

  const { value, telemetry } = await callJson({
    role: "assessor",
    transport,
    models: llmModels,
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
  attempts.push(...telemetry.attempts);
  return { text: value ? value.text.trim() : null, ms: Date.now() - started, via: "llm", attempts };
}

async function groqWhisper(apiKey: string, wavBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "answer.wav");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "en");
  form.append("prompt", WHISPER_PROMPT);
  form.append("response_format", "json");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}
