import type { DecisionLogRow, InputSource, SessionResponse, TurnView } from "../core/api";

// Thin client with the retry rules from DESIGN.md: a turn is sent with a
// clientTurnId, so retrying after a network error can never apply it twice.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Server-provided reason, e.g. "session_closed" or "conflict". */
    public code?: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const { error, code } = data as { error?: string; code?: string };
      throw new ApiError(res.status, error ?? `HTTP ${res.status}`, code);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, ctrl.signal.aborted ? "The tutor took too long to respond." : "Network problem.");
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Retry once on network failures / 5xx; never on 4xx.
    if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
      await new Promise((r) => setTimeout(r, 800));
      return fn();
    }
    throw err;
  }
}

export const api = {
  startSession: (studentId: string | null, forceNew = false) =>
    withRetry(() => post<SessionResponse>("/api/session", { studentId, forceNew })),

  /** Reuse the same clientTurnId when the user retries a failed send. */
  sendTurn: (sessionId: string, clientTurnId: string, text: string, inputSource: InputSource, clientTimings?: Record<string, number>) =>
    withRetry(() => post<TurnView>("/api/turn", { sessionId, clientTurnId, text, inputSource, clientTimings })),

  transcribe: (audioBase64: string) => post<{ text: string; ms: number }>("/api/stt", { audio: audioBase64 }, 20_000),

  /** Best effort: a slow or failed log only means an empty side panel, never a stuck start. */
  decisionLog: async (sessionId: string): Promise<DecisionLogRow[]> => {
    try {
      const res = await fetch(`/api/session/${sessionId}/log`, { signal: AbortSignal.timeout(8000) });
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  },
};
