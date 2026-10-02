import { quadratics } from "../core/curriculum/quadratics";
import type { EngineDeps } from "../core/engine";
import { groq, openRouter, RoutedTransport, type LlmTransport } from "../core/llm";
import { HttpError } from "./http";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_KEY: string;
  GROQ_API_KEY?: string;
  MODEL_ASSESSOR: string;
  MODEL_RESPONDER: string;
  MODEL_FALLBACK: string;
  MODEL_FALLBACK_2?: string;
  MODEL_STT: string;
  MODEL_STT_FALLBACK: string;
  SESSION_TIMEOUT_MIN?: string;
}

export const curriculum = quadratics;

/** OpenRouter by default; "groq:"-prefixed models go to Groq when its key is set. */
export function transport(env: Env): LlmTransport {
  if (!env.OPENROUTER_KEY && !env.GROQ_API_KEY) throw new HttpError(500, "server misconfigured: no LLM provider key");
  return new RoutedTransport({ groq: env.GROQ_API_KEY ? groq(env.GROQ_API_KEY) : undefined }, openRouter(env.OPENROUTER_KEY ?? ""));
}

export function engineDeps(env: Env): EngineDeps {
  return {
    curriculum,
    transport: transport(env),
    models: { assessor: env.MODEL_ASSESSOR, responder: env.MODEL_RESPONDER, fallback: env.MODEL_FALLBACK, fallback2: env.MODEL_FALLBACK_2 },
  };
}

/** Inactivity after which the next visit starts a new session. Defaults to 30 minutes on a bad value. */
export function sessionTimeoutMs(env: Env): number {
  const minutes = Number(env.SESSION_TIMEOUT_MIN ?? 30);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
}
