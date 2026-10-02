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
  /** Tried after the primary; should be on a different provider (e.g. "groq:qwen/qwen3.8-27b"). */
  fallback: string;
  /** Last resort, optional. */
  fallback2?: string;
}

/** The order models are tried in for one call. */
export function modelChain(primary: string, m: ModelConfig): string[] {
  return [primary, primary, m.fallback, ...(m.fallback2 ? [m.fallback2] : [])];
}

/**
 * Any OpenAI-compatible chat completions endpoint (OpenRouter, Groq).
 * Model ids are passed through unchanged; routing happens in RoutedTransport.
 */
export class OpenAICompatibleTransport implements LlmTransport {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private extraHeaders: Record<string, string> = {},
    private extraBody: (model: string) => Record<string, unknown> = () => ({}),
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...this.extraHeaders },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        response_format: { type: "json_object" },
        ...this.extraBody(req.model),
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

export const openRouter = (apiKey: string) =>
  new OpenAICompatibleTransport("https://openrouter.ai/api/v1", apiKey, { "HTTP-Referer": "https://quadratic-tutor", "X-Title": "Quadratic Tutor" });

// gpt-oss on Groq is a reasoning model; low effort keeps it fast and inside max_tokens.
export const groq = (apiKey: string) =>
  new OpenAICompatibleTransport("https://api.groq.com/openai/v1", apiKey, {}, (model) => (model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}));

/**
 * Routes by model-id prefix: "groq:openai/gpt-oss-120b" goes to Groq as
 * "openai/gpt-oss-120b"; anything unprefixed goes to the default (OpenRouter).
 * A provider without a key is simply absent, and its models fail fast.
 */
export class RoutedTransport implements LlmTransport {
  constructor(
    private providers: Record<string, LlmTransport | undefined>,
    private defaultProvider: LlmTransport,
  ) {}

  complete(req: CompletionRequest): Promise<CompletionResponse> {
    const { provider, model } = splitModel(req.model);
    if (provider === "openrouter") return this.defaultProvider.complete(req);
    const t = this.providers[provider];
    if (!t) return Promise.reject(new LlmError("no_provider", `no API key configured for ${provider}`));
    return t.complete({ ...req, model });
  }
}

export function splitModel(id: string): { provider: string; model: string } {
  const m = id.match(/^([a-z]+):(.+)$/);
  return m ? { provider: m[1], model: m[2] } : { provider: "openrouter", model: id };
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
  providerDown.clear();
}

// Out of credit / bad key is a provider-wide condition: skip every model on that
// provider for a while instead of discovering it again model by model, turn by turn.
const providerDown = new Map<string, number>();
const PROVIDER_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_FATAL = /\b(http_401|http_402|http_403|no_provider)\b/;

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
    const provider = splitModel(model).provider;
    if ((providerDown.get(provider) ?? 0) > Date.now()) {
      telemetry.attempts.push({ model, ok: false, ms: 0, error: `provider_down:${provider}` });
      continue;
    }
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
      if (PROVIDER_FATAL.test(error)) providerDown.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
      telemetry.attempts.push({ model, ok: false, ms: Date.now() - t0, error: error.slice(0, 300) });
    } finally {
      clearTimeout(timer);
    }
  }

  telemetry.ms = Date.now() - started;
  telemetry.usedFallback = true;
  return { value: null, telemetry };
}
