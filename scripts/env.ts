import { readFileSync } from "node:fs";
import { OpenRouterTransport, type ModelConfig } from "../src/core/llm";

// Node-side config for evals and simulations: reads OPENROUTER_KEY from .env.
export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // no .env; rely on process.env
  }
  return env;
}

export const DEFAULT_MODELS: ModelConfig = {
  assessor: "google/gemini-3.5-flash-lite",
  responder: "openai/gpt-5.4",
  fallback: "anthropic/claude-haiku-4.5",
};

export function nodeDeps() {
  const env = loadEnv();
  const key = env.OPENROUTER_KEY ?? env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_KEY missing (set it in .env)");
  const models: ModelConfig = {
    assessor: env.MODEL_ASSESSOR ?? DEFAULT_MODELS.assessor,
    responder: env.MODEL_RESPONDER ?? DEFAULT_MODELS.responder,
    fallback: env.MODEL_FALLBACK ?? DEFAULT_MODELS.fallback,
  };
  return { transport: new OpenRouterTransport(key), models };
}
