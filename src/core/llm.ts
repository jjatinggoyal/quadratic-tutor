import type { z } from "zod";
import type { LlmCallTelemetry } from "./types";

// OpenRouter client plus the reliability policy around it:
//   - per-attempt timeout (AbortController)
//   - attempt chain: primary → primary again → fallback model (different provider)
//   - every response is JSON-parsed and schema-validated; garbage counts as a failure
//   - a small circuit breaker skips a model that has failed repeatedly
// If the whole chain fails the caller gets `value: null` and must degrade
// gracefully (see engine.ts). Nothing here ever throws to the caller.

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface CompletionResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/** Transport abstraction, so evals can inject timeouts and garbage. */
export interface LlmTransport {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export interface ModelConfig {
  assessor: string;
  responder: string;
  fallback: string;
}

export class OpenRouterTransport implements LlmTransport {
  constructor(
    private apiKey: string,
    private appUrl = "https://quadratic-tutor",
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: req.signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.appUrl,
        "X-Title": "Quadratic Tutor",
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`http_${res.status}`, body.slice(0, 200));
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new LlmError("empty_response", data.error?.message ?? "");
    }
    return { text, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 };
  }
}

export class LlmError extends Error {
  constructor(
    public code: string,
    detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

// ---------------------------------------------------------------------------

const breaker = new Map<string, { failures: number; openUntil: number }>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

function breakerOpen(model: string, now: number) {
  const b = breaker.get(model);
  return !!b && b.openUntil > now;
}
function recordResult(model: string, ok: boolean, now: number) {
  const b = breaker.get(model) ?? { failures: 0, openUntil: 0 };
  if (ok) b.failures = 0;
  else if (++b.failures >= BREAKER_THRESHOLD) b.openUntil = now + BREAKER_COOLDOWN_MS;
  breaker.set(model, b);
}
export function resetBreakers() {
  breaker.clear();
}

/** Pull the first JSON object out of a response, tolerating code fences and chatter. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new LlmError("not_json", cleaned.slice(0, 120));
  }
}

export interface JsonCallOptions<T> {
  role: LlmCallTelemetry["role"];
  transport: LlmTransport;
  models: string[]; // attempt chain, e.g. [primary, primary, fallback]
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Semantic check after schema validation; return a problem description to reject and retry. */
  validate?: (value: T) => string | null;
  maxTokens: number;
  temperature?: number;
  timeoutMs: number; // per attempt
  budgetMs: number; // whole chain; the student is waiting on this
}

export async function callJson<T>(opts: JsonCallOptions<T>): Promise<{ value: T | null; telemetry: LlmCallTelemetry }> {
  const telemetry: LlmCallTelemetry = {
    role: opts.role,
    model: null,
    attempts: [],
    ms: 0,
    tokensIn: 0,
    tokensOut: 0,
    usedFallback: false,
  };
  const started = Date.now();
  let messages = opts.messages;

  for (const [i, model] of opts.models.entries()) {
    const remaining = opts.budgetMs - (Date.now() - started);
    if (remaining < 500) {
      telemetry.attempts.push({ model, ok: false, ms: 0, error: "budget_exhausted" });
      break;
    }
    // Retrying the same model right after it timed out just doubles the wait; go to the next model instead.
    const prev = telemetry.attempts[telemetry.attempts.length - 1];
    if (i > 0 && opts.models[i - 1] === model && prev?.error === "timeout") continue;
    if (breakerOpen(model, Date.now())) {
      telemetry.attempts.push({ model, ok: false, ms: 0, error: "circuit_open" });
      continue;
    }
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs, remaining));
    try {
      const res = await opts.transport.complete({
        model,
        messages,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature ?? 0.4,
        signal: ctrl.signal,
      });
      telemetry.tokensIn += res.tokensIn;
      telemetry.tokensOut += res.tokensOut;
      const parsed = opts.schema.safeParse(extractJson(res.text));
      if (!parsed.success) {
        throw new LlmError("schema_invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      const problem = opts.validate?.(parsed.data);
      if (problem) {
        // The model is healthy, the answer isn't: retry with feedback instead of tripping the breaker.
        telemetry.attempts.push({ model, ok: false, ms: Date.now() - t0, error: `rejected: ${problem}` });
        messages = [...opts.messages, { role: "assistant", content: res.text }, { role: "user", content: `That reply was rejected: ${problem}. Send a corrected JSON reply.` }];
        continue;
      }
      recordResult(model, true, Date.now());
      telemetry.attempts.push({ model, ok: true, ms: Date.now() - t0 });
      telemetry.model = model;
      telemetry.ms = Date.now() - started;
      return { value: parsed.data, telemetry };
    } catch (err) {
      const error = ctrl.signal.aborted ? "timeout" : err instanceof LlmError ? err.message : String(err);
      recordResult(model, false, Date.now());
      telemetry.attempts.push({ model, ok: false, ms: Date.now() - t0, error: error.slice(0, 300) });
    } finally {
      clearTimeout(timer);
    }
  }

  telemetry.ms = Date.now() - started;
  telemetry.usedFallback = true;
  return { value: null, telemetry };
}
