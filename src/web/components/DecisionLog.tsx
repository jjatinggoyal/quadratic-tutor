import type { TutorAction } from "../../core/types";

export interface LogEntry {
  seq: number;
  studentText: string | null;
  action: TutorAction | string;
  reason: string;
  correct: boolean | null;
  degraded: boolean;
  totalMs: number;
}

const ACTION_LABEL: Record<string, string> = {
  teach: "Teach",
  next_check: "Check again",
  advance: "Move on",
  reteach: "Re-teach",
  move_on_flagged: "Move on (flagged)",
  answer_question: "Answer question",
  redirect: "Redirect",
  clarify: "Clarify",
  complete: "Complete",
};

/** "Why did the tutor do that?": the policy's reason for every turn. */
export function DecisionLog({ entries }: { entries: LogEntry[] }) {
  return (
    <aside className="log" aria-label="Tutor decisions">
      <div className="log-head">Why the tutor did that</div>
      {entries.length === 0 && <div className="log-empty">Each decision and its reason will appear here.</div>}
      <ol reversed>
        {[...entries].reverse().map((e) => (
          <li key={e.seq} className={`log-item action-${e.action}`}>
            <div className="log-row">
              <span className="log-badge">{ACTION_LABEL[e.action] ?? e.action}</span>
              {e.correct !== null && <span className={`log-grade ${e.correct ? "ok" : "bad"}`}>{e.correct ? "correct" : "incorrect"}</span>}
              {e.degraded && <span className="log-degraded" title="The LLM was unavailable; a fallback path was used.">fallback</span>}
              <span className="log-ms">{(e.totalMs / 1000).toFixed(1)}s</span>
            </div>
            {e.studentText && <div className="log-said">“{e.studentText}”</div>}
            <div className="log-reason">{e.reason}</div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
