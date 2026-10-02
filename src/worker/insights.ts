import type { Insights, SimFilter } from "../core/api";
import type { Curriculum } from "../core/types";

// Aggregates for the /insights page, computed from the turn log. Nothing here
// needs extra instrumentation: every number comes from columns the turn
// pipeline already writes (see DESIGN.md §3 and §5).

export async function computeInsights(db: D1Database, c: Curriculum, sim: SimFilter, sessionTimeoutMs: number): Promise<Insights> {
  // Joins every query to students so simulated traffic can be included, excluded, or isolated.
  const who = sim === "include" ? "1=1" : sim === "only" ? "st.is_simulated = 1" : "st.is_simulated = 0";
  const turnsJoin = `turns t JOIN sessions se ON se.id = t.session_id JOIN students st ON st.id = se.student_id`;

  const q = <T>(sql: string) => db.prepare(sql).all<T>().then((r) => r.results);

  const [overview, funnel, reteach, misconceptions, checks, intents, latency, versions, dropoff, retention, sources] = await Promise.all([
    q<{ students: number; sessions: number; turns: number; finished: number; returning_students: number }>(`
      SELECT
        (SELECT COUNT(*) FROM students st WHERE ${who}) AS students,
        (SELECT COUNT(*) FROM sessions se JOIN students st ON st.id = se.student_id WHERE ${who}) AS sessions,
        (SELECT COUNT(*) FROM ${turnsJoin} WHERE ${who}) AS turns,
        (SELECT COUNT(*) FROM sessions se JOIN students st ON st.id = se.student_id WHERE ${who} AND se.end_reason = 'finished') AS finished,
        (SELECT COUNT(DISTINCT se.student_id) FROM sessions se JOIN students st ON st.id = se.student_id WHERE ${who} AND se.session_number > 1) AS returning_students`),

    q<{ subconcept_id: string; status: string; n: number }>(`
      SELECT p.subconcept_id, p.status, COUNT(*) AS n
      FROM subconcept_progress p JOIN students st ON st.id = p.student_id WHERE ${who}
      GROUP BY 1, 2`),

    // Re-teach success: was the next graded answer after a re-teach correct?
    q<{ subconcept_id: string; strategy_id: string; n: number; success: number | null }>(`
      WITH g AS (
        SELECT t.subconcept_id, t.strategy_id, t.action,
               LEAD(t.correct) OVER (PARTITION BY t.session_id ORDER BY t.seq) AS next_correct
        FROM ${turnsJoin}
        WHERE ${who} AND (t.intent = 'answer' OR t.action = 'reteach'))
      SELECT subconcept_id, strategy_id, COUNT(next_correct) AS n, AVG(next_correct) AS success
      FROM g WHERE action = 'reteach' GROUP BY 1, 2 ORDER BY 1, 2`),

    q<{ subconcept_id: string; misconception_id: string; seen: number; fixed: number }>(`
      SELECT t.subconcept_id, t.misconception_id, COUNT(*) AS seen,
             (SELECT COUNT(*) FROM turns f WHERE f.fixed_misconception = t.misconception_id AND f.session_id IN
                (SELECT se2.id FROM sessions se2 JOIN students st2 ON st2.id = se2.student_id WHERE ${who.replace(/st\./g, "st2.")})) AS fixed
      FROM ${turnsJoin}
      WHERE ${who} AND t.correct = 0 AND t.misconception_id IS NOT NULL
      GROUP BY 1, 2 ORDER BY seen DESC LIMIT 12`),

    // Per-question difficulty and how often replies to it were unclear (a wording smell).
    q<{ subconcept_id: string; check_id: string; answers: number; correct: number; unclear: number }>(`
      SELECT t.subconcept_id, t.check_id,
             SUM(t.intent = 'answer') AS answers, SUM(t.correct = 1) AS correct, SUM(t.intent = 'unclear') AS unclear
      FROM ${turnsJoin} WHERE ${who} AND t.check_id IS NOT NULL AND t.student_text IS NOT NULL
      GROUP BY 1, 2 HAVING answers + unclear >= 2`),

    q<{ intent: string | null; action: string; n: number }>(`
      SELECT t.intent, t.action, COUNT(*) AS n FROM ${turnsJoin} WHERE ${who} GROUP BY 1, 2`),

    q<{ total_ms: number; assessor_ms: number | null; responder_ms: number | null; degraded: number }>(`
      SELECT t.total_ms, t.assessor_ms, t.responder_ms, t.degraded FROM ${turnsJoin}
      WHERE ${who} AND t.student_text IS NOT NULL ORDER BY t.created_at DESC LIMIT 2000`),

    q<{ prompt_version: string; responder_model: string | null; turns: number; degraded: number; reteaches: number; graded: number; correct: number }>(`
      SELECT t.prompt_version, t.responder_model, COUNT(*) AS turns, SUM(t.degraded) AS degraded,
             SUM(t.action = 'reteach') AS reteaches, SUM(t.correct IS NOT NULL) AS graded, SUM(t.correct = 1) AS correct
      FROM ${turnsJoin} WHERE ${who} GROUP BY 1, 2 ORDER BY MIN(t.created_at) DESC LIMIT 8`),

    // Where students stopped. A session only gets end_reason 'inactive' when the student starts another one,
    // so students who never came back are the still-"active" sessions that have gone stale.
    q<{ subconcept_id: string | null; action: string; n: number }>(`
      SELECT t.subconcept_id, t.action, COUNT(*) AS n
      FROM sessions se JOIN students st ON st.id = se.student_id
      JOIN turns t ON t.session_id = se.id AND t.seq = se.turn_count
      WHERE ${who} AND (se.end_reason = 'inactive' OR (se.status = 'active' AND se.updated_at < ${Date.now() - sessionTimeoutMs}))
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`),

    q<{ subconcept_id: string; passed: number; failed: number }>(`
      SELECT p.subconcept_id, SUM(p.reviews_passed) AS passed, SUM(p.reviews_failed) AS failed
      FROM subconcept_progress p JOIN students st ON st.id = p.student_id WHERE ${who}
      GROUP BY 1 HAVING passed + failed > 0`),

    q<{ input_source: string | null; n: number }>(`
      SELECT t.input_source, COUNT(*) AS n FROM ${turnsJoin} WHERE ${who} AND t.student_text IS NOT NULL GROUP BY 1`),
  ]);

  const title = (id: string | null) => c.subconcepts.find((s) => s.id === id)?.title ?? id ?? "—";
  const strategyName = (sub: string, id: string) => c.subconcepts.find((s) => s.id === sub)?.strategies.find((x) => x.id === id)?.name ?? id;
  const misLabel = (id: string) => c.subconcepts.flatMap((s) => s.misconceptions).find((m) => m.id === id)?.label ?? id;
  const checkText = (sub: string, id: string) => {
    const q = c.subconcepts.find((s) => s.id === sub)?.checks.find((x) => x.id === id);
    return q ? `${q.text}${q.math ? ` ${q.math}` : ""}` : id;
  };
  const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null);
  const o = overview[0];
  const graded = intents.filter((i) => i.intent).reduce((a, i) => a + i.n, 0);

  return {
    sim,
    generatedAt: Date.now(),
    overview: {
      students: o.students,
      sessions: o.sessions,
      turns: o.turns,
      finishedSessions: o.finished,
      returningStudents: o.returning_students,
      turnsPerSession: o.sessions ? o.turns / o.sessions : 0,
    },
    reteachSuccessOverall: weighted(reteach.map((r) => ({ n: r.n, v: r.success }))),
    funnel: c.subconcepts.map((s) => {
      const rows = funnel.filter((f) => f.subconcept_id === s.id);
      const n = (status: string) => rows.find((r) => r.status === status)?.n ?? 0;
      return { id: s.id, title: s.title, mastered: n("mastered"), inProgress: n("in_progress"), needsReview: n("needs_review") };
    }),
    reteach: reteach.map((r) => ({ subconcept: title(r.subconcept_id), strategy: strategyName(r.subconcept_id, r.strategy_id), n: r.n, success: r.success })),
    misconceptions: misconceptions.map((m) => ({ subconcept: title(m.subconcept_id), label: misLabel(m.misconception_id), seen: m.seen, fixed: m.fixed })),
    hardestChecks: checks
      .map((k) => ({ subconcept: title(k.subconcept_id), question: checkText(k.subconcept_id, k.check_id), answers: k.answers, accuracy: k.answers ? k.correct / k.answers : null, unclearRate: k.unclear / (k.answers + k.unclear) }))
      .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
      .slice(0, 8),
    intents: Object.entries(group(intents.filter((i) => i.intent), (i) => i.intent!)).map(([intent, n]) => ({ intent, share: graded ? n / graded : 0, n })),
    actions: Object.entries(group(intents, (i) => i.action)).map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n),
    latency: {
      p50: pct(latency.map((l) => l.total_ms), 0.5),
      p90: pct(latency.map((l) => l.total_ms), 0.9),
      assessorP50: pct(latency.flatMap((l) => (l.assessor_ms ? [l.assessor_ms] : [])), 0.5),
      responderP50: pct(latency.flatMap((l) => (l.responder_ms ? [l.responder_ms] : [])), 0.5),
      degradedRate: latency.length ? latency.reduce((a, l) => a + l.degraded, 0) / latency.length : 0,
      sample: latency.length,
    },
    versions: versions.map((v) => ({ promptVersion: v.prompt_version, responderModel: v.responder_model, turns: v.turns, degradedRate: v.degraded / v.turns, reteachRate: v.reteaches / v.turns, accuracy: v.graded ? v.correct / v.graded : null })),
    dropoff: dropoff.map((d) => ({ subconcept: title(d.subconcept_id), action: d.action, n: d.n })),
    retention: retention.map((r) => ({ subconcept: title(r.subconcept_id), passed: r.passed, failed: r.failed })),
    inputSources: sources.map((s) => ({ source: s.input_source ?? "unknown", n: s.n })),
  };
}

function group<T>(rows: (T & { n: number })[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + r.n;
  return out;
}

function weighted(xs: { n: number; v: number | null }[]): number | null {
  const valid = xs.filter((x) => x.v !== null && x.n > 0);
  const n = valid.reduce((a, x) => a + x.n, 0);
  return n ? valid.reduce((a, x) => a + x.n * (x.v as number), 0) / n : null;
}
