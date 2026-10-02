import type { ProgressRow } from "../../core/api";

const LABEL: Record<ProgressRow["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  mastered: "Mastered",
  needs_review: "Needs review",
};

export function ProgressRail({ rows }: { rows: ProgressRow[] }) {
  const mastered = rows.filter((r) => r.status === "mastered").length;
  return (
    <nav className="rail" aria-label="Progress">
      <div className="rail-head">
        <span>Progress</span>
        <span className="rail-count">
          {mastered}/{rows.length} mastered
        </span>
      </div>
      <ol>
        {rows.map((r, i) => (
          <li key={r.id} className={`rail-item status-${r.status} ${r.current ? "current" : ""}`} title={LABEL[r.status]}>
            <span className="rail-dot">{r.status === "mastered" ? "✓" : r.status === "needs_review" ? "!" : i + 1}</span>
            <span className="rail-text">
              <span className="rail-title">{r.title}</span>
              <span className="rail-meta">
                {LABEL[r.status]}
                {r.checksAttempted > 0 && ` · ${r.checksCorrect}/${r.checksAttempted} correct`}
                {r.reteachCount > 0 && ` · re-taught ${r.reteachCount}×`}
                {r.reviewsPassed > 0 && " · remembered ✓"}
              </span>
              {r.mistakes.length > 0 && (
                <span className="rail-mistakes">
                  {r.mistakes.slice(0, 2).map((m) => (
                    <span key={m.id} className={`mistake ${m.fixed ? "fixed" : ""}`} title={m.fixed ? "You made this mistake and then fixed it" : "A mistake to watch for"}>
                      {m.fixed ? "✓" : "⚠"} {m.label}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
