import { useEffect, useState } from "react";
import type { Insights, SimFilter } from "../core/api";

// /insights: what the turn log says about how the tutor is doing.
// Ordered by the questions in DESIGN.md §5: is the re-teach loop working,
// where do students get stuck, what goes wrong, and is the system healthy.

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const sec = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);

function Bar({ value, tone = "accent" }: { value: number | null; tone?: "accent" | "ok" | "warn" | "bad" }) {
  return (
    <span className="bar">
      <span className={`bar-fill ${tone}`} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="ins-card">
      <h2>{title}</h2>
      {hint && <p className="ins-hint">{hint}</p>}
      {children}
    </section>
  );
}

export function InsightsPage() {
  const [sim, setSim] = useState<SimFilter>("include");
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/insights?sim=${sim}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData, (e) => setError(String(e)));
  }, [sim]);

  return (
    <div className="ins">
      <header className="top">
        <div className="brand">
          <span className="brand-mark">📐</span> Quadratic Tutor · Insights
        </div>
        <div className="settings">
          <label>
            Traffic
            <select value={sim} onChange={(e) => setSim(e.target.value as SimFilter)}>
              <option value="include">All</option>
              <option value="exclude">Real students only</option>
              <option value="only">Simulated only</option>
            </select>
          </label>
          <a href="/">← Back to tutor</a>
        </div>
      </header>

      {error && <p className="error ins-pad">{error}</p>}
      {!data && !error && <p className="ins-pad">Loading…</p>}
      {data && data.overview.turns === 0 && <p className="ins-pad">No turns yet for this filter.</p>}
      {data && data.overview.turns > 0 && (
        <main className="ins-grid">
          <section className="ins-kpis">
            <div className="kpi headline">
              <div className="kpi-v">{pct(data.reteachSuccessOverall)}</div>
              <div className="kpi-l">Re-teach success</div>
              <div className="kpi-s">next answer correct after a re-teach</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">{data.overview.students}</div>
              <div className="kpi-l">Students</div>
              <div className="kpi-s">{data.overview.returningStudents} came back for another session</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">{data.overview.sessions}</div>
              <div className="kpi-l">Sessions</div>
              <div className="kpi-s">{data.overview.turnsPerSession.toFixed(1)} turns each · {data.overview.finishedSessions} finished</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">{sec(data.latency.p50)}</div>
              <div className="kpi-l">Turn latency p50</div>
              <div className="kpi-s">p90 {sec(data.latency.p90)} · {pct(data.latency.degradedRate)} degraded</div>
            </div>
          </section>

          <Card title="Mastery funnel" hint="Students per topic, by status. A high 'needs review' share points at the curriculum, not the student.">
            <table>
              <thead>
                <tr><th>Topic</th><th>Mastered</th><th>In progress</th><th>Needs review</th></tr>
              </thead>
              <tbody>
                {data.funnel.map((f) => (
                  <tr key={f.id}>
                    <td>{f.title}</td>
                    <td className="num ok-t">{f.mastered}</td>
                    <td className="num">{f.inProgress}</td>
                    <td className="num warn-t">{f.needsReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Which explanations work" hint="Re-teach success by strategy: was the student's next answer correct? Feed the winners back into strategy choice.">
            {data.reteach.length === 0 ? <p className="ins-hint">No re-teaches yet.</p> : (
              <table>
                <thead><tr><th>Topic</th><th>Strategy</th><th>n</th><th>Success</th></tr></thead>
                <tbody>
                  {data.reteach.map((r, i) => (
                    <tr key={i}>
                      <td>{r.subconcept}</td>
                      <td>{r.strategy}</td>
                      <td className="num">{r.n}</td>
                      <td className="num"><Bar value={r.success} tone={(r.success ?? 0) >= 0.6 ? "ok" : "warn"} /> {pct(r.success)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Most common mistakes" hint="Misconceptions behind wrong answers, and how often students later fixed them.">
            {data.misconceptions.length === 0 ? <p className="ins-hint">None detected yet.</p> : (
              <table>
                <thead><tr><th>Mistake</th><th>Topic</th><th>Seen</th><th>Fixed</th></tr></thead>
                <tbody>
                  {data.misconceptions.map((m, i) => (
                    <tr key={i}>
                      <td>{m.label}</td>
                      <td className="muted">{m.subconcept}</td>
                      <td className="num">{m.seen}</td>
                      <td className="num ok-t">{m.fixed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Hardest questions" hint="Lowest accuracy first. A high 'unclear' rate suggests confusing wording rather than a hard idea.">
            <table>
              <thead><tr><th>Question</th><th>Answers</th><th>Accuracy</th><th>Unclear</th></tr></thead>
              <tbody>
                {data.hardestChecks.map((q, i) => (
                  <tr key={i}>
                    <td><div>{q.question}</div><div className="muted small">{q.subconcept}</div></td>
                    <td className="num">{q.answers}</td>
                    <td className="num">{pct(q.accuracy)}</td>
                    <td className={`num ${q.unclearRate > 0.25 ? "warn-t" : ""}`}>{pct(q.unclearRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Retention" hint="Warm-up questions at the start of later sessions, on topics mastered before.">
            {data.retention.length === 0 ? <p className="ins-hint">No returning sessions yet.</p> : (
              <table>
                <thead><tr><th>Topic</th><th>Remembered</th><th>Forgot</th></tr></thead>
                <tbody>
                  {data.retention.map((r, i) => (
                    <tr key={i}><td>{r.subconcept}</td><td className="num ok-t">{r.passed}</td><td className="num warn-t">{r.failed}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Where students stop" hint="The last turn of sessions that ended through inactivity.">
            {data.dropoff.length === 0 ? <p className="ins-hint">No abandoned sessions yet.</p> : (
              <table>
                <thead><tr><th>Topic</th><th>Last tutor action</th><th>Sessions</th></tr></thead>
                <tbody>
                  {data.dropoff.map((d, i) => (
                    <tr key={i}><td>{d.subconcept}</td><td>{d.action}</td><td className="num">{d.n}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="What students say" hint="How the assessor classified replies. Rising 'unclear' means STT or the assessor is struggling.">
            <table>
              <tbody>
                {data.intents.sort((a, b) => b.n - a.n).map((x) => (
                  <tr key={x.intent}><td>{x.intent}</td><td className="num"><Bar value={x.share} /> {pct(x.share)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="ins-hint">Input: {data.inputSources.map((s) => `${s.source} ${s.n}`).join(" · ")}</p>
          </Card>

          <Card title="By prompt & model version" hint="Compare versions after a change: accuracy, re-teach rate and degraded rate should not get worse.">
            <table>
              <thead><tr><th>Prompt</th><th>Responder</th><th>Turns</th><th>Accuracy</th><th>Re-teach</th><th>Degraded</th></tr></thead>
              <tbody>
                {data.versions.map((v, i) => (
                  <tr key={i}>
                    <td className="mono">{v.promptVersion}</td>
                    <td className="mono">{v.responderModel ?? "—"}</td>
                    <td className="num">{v.turns}</td>
                    <td className="num">{pct(v.accuracy)}</td>
                    <td className="num">{pct(v.reteachRate)}</td>
                    <td className="num">{pct(v.degradedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ins-hint">
              Latency p50: assessor {sec(data.latency.assessorP50)}, responder {sec(data.latency.responderP50)} (last {data.latency.sample} turns)
            </p>
          </Card>
        </main>
      )}
    </div>
  );
}
