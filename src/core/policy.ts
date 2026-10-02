import { describeAnswer, describeExtracted } from "./grader";
import type { Assessment, CheckItem, Curriculum, Decision, SessionState, Subconcept, SubconceptProgress } from "./types";

// The teaching loop, as a pure function: (state, assessment) → (decision, next state).
// No LLM is involved in choosing what happens next, which is what makes the
// tutor's choices reproducible, testable, and explainable.

export function getSubconcept(c: Curriculum, id: string | null): Subconcept | null {
  return id ? (c.subconcepts.find((s) => s.id === id) ?? null) : null;
}

export function getCheck(sub: Subconcept | null, id: string | null): CheckItem | null {
  return sub && id ? (sub.checks.find((q) => q.id === id) ?? null) : null;
}

function emptyProgress(subconceptId: string): SubconceptProgress {
  return {
    subconceptId,
    status: "not_started",
    checksAttempted: 0,
    checksCorrect: 0,
    reteachCount: 0,
    strategiesUsed: [],
    misconceptions: {},
    fixed: [],
    reviewsPassed: 0,
    reviewsFailed: 0,
  };
}

/** Fill fields added after a state or progress row was saved, so old sessions keep working. */
function normaliseProgress(p: Partial<SubconceptProgress> & { subconceptId: string }): SubconceptProgress {
  return { ...emptyProgress(p.subconceptId), ...p };
}

export function initialState(c: Curriculum): SessionState {
  return stateFromProgress(c, {});
}

/**
 * Start a new session from a student's long-lived progress. It begins at the
 * first subconcept that isn't mastered, so topics flagged for review in an
 * earlier session are revisited.
 */
export function stateFromProgress(c: Curriculum, saved: Record<string, SubconceptProgress>): SessionState {
  const progress = Object.fromEntries(c.subconcepts.map((s) => [s.id, saved[s.id] ? normaliseProgress(saved[s.id]) : emptyProgress(s.id)]));
  const base: SessionState = {
    curriculumId: c.id,
    curriculumVersion: c.version,
    subconceptId: null,
    strategyIndex: 0,
    pendingCheckId: null,
    usedCheckIds: [],
    correctInARow: 0,
    reteachesHere: 0,
    board: [],
    progress,
    recentDecisions: [],
    streak: 0,
    lastMisconception: null,
    review: null,
  };
  const start = c.subconcepts.find((s) => progress[s.id].status !== "mastered");
  return start ? enterSubconcept(base, start) : base;
}

/**
 * Open a later session with a retention question from an already mastered
 * topic. Uses the topic's last check, which a student who mastered it in two
 * checks is least likely to have seen. Afterwards the student continues where
 * the session would otherwise have started.
 */
export function startReview(c: Curriculum, state: SessionState, subconceptId: string): SessionState {
  const sub = getSubconcept(c, subconceptId);
  if (!sub || state.progress[sub.id]?.status !== "mastered") return state;
  const check = sub.checks[sub.checks.length - 1];
  return {
    ...state,
    review: { returnTo: state.subconceptId },
    subconceptId: sub.id,
    strategyIndex: 0,
    pendingCheckId: check.id,
    usedCheckIds: [check.id],
    correctInARow: 0,
    reteachesHere: 0,
  };
}

/**
 * Bring a saved state in line with the current curriculum. Progress is keyed by
 * stable subconcept id, so it survives reordering; removed subconcepts are
 * dropped; new ones start as not_started. If the current subconcept or pending
 * check no longer exists, the student restarts that subconcept cleanly.
 */
export function rebaseState(saved: SessionState, c: Curriculum): SessionState {
  const state: SessionState = {
    ...saved,
    recentDecisions: saved.recentDecisions ?? [],
    streak: saved.streak ?? 0,
    lastMisconception: saved.lastMisconception ?? null,
    review: saved.review ?? null,
    progress: Object.fromEntries(Object.entries(saved.progress).map(([id, p]) => [id, normaliseProgress(p)])),
  };
  if (state.curriculumVersion === c.version && state.curriculumId === c.id) return state;
  const progress = Object.fromEntries(c.subconcepts.map((s) => [s.id, state.progress[s.id] ?? emptyProgress(s.id)]));
  const next: SessionState = { ...state, curriculumId: c.id, curriculumVersion: c.version, progress };
  const sub = getSubconcept(c, state.subconceptId);
  if (sub && getCheck(sub, state.pendingCheckId)) {
    return { ...next, strategyIndex: Math.min(state.strategyIndex, sub.strategies.length - 1) };
  }
  const resumeAt = sub ?? nextOpenSubconcept(c, next, -1);
  return resumeAt ? enterSubconcept(next, resumeAt) : { ...next, subconceptId: null, pendingCheckId: null };
}

function enterSubconcept(state: SessionState, sub: Subconcept): SessionState {
  const first = sub.checks[0];
  const prog = state.progress[sub.id] ?? emptyProgress(sub.id);
  return {
    ...state,
    subconceptId: sub.id,
    strategyIndex: 0,
    pendingCheckId: first.id,
    usedCheckIds: [first.id],
    correctInARow: 0,
    reteachesHere: 0,
    progress: {
      ...state.progress,
      [sub.id]: {
        ...prog,
        status: prog.status === "mastered" ? "mastered" : "in_progress",
        strategiesUsed: addUnique(prog.strategiesUsed, sub.strategies[0].id),
      },
    },
  };
}

/** First subconcept after `afterIndex` that isn't mastered or flagged. */
function nextOpenSubconcept(c: Curriculum, state: SessionState, afterIndex: number): Subconcept | null {
  for (let i = afterIndex + 1; i < c.subconcepts.length; i++) {
    const s = c.subconcepts[i];
    const status = state.progress[s.id]?.status;
    if (status !== "mastered" && status !== "needs_review") return s;
  }
  return null;
}

/** Deterministic: the first check not yet used in this visit; recycles once all are used. */
function pickNextCheck(sub: Subconcept, used: string[], current: string | null): { check: CheckItem; used: string[] } {
  const fresh = sub.checks.find((q) => !used.includes(q.id));
  if (fresh) return { check: fresh, used: [...used, fresh.id] };
  const recycled = sub.checks.find((q) => q.id !== current) ?? sub.checks[0];
  return { check: recycled, used: [recycled.id] };
}

function addUnique(xs: string[], x: string) {
  return xs.includes(x) ? xs : [...xs, x];
}

export interface PolicyResult {
  decision: Decision;
  state: SessionState;
}

export function decide(c: Curriculum, state: SessionState, a: Assessment): PolicyResult {
  const sub = getSubconcept(c, state.subconceptId);
  const check = getCheck(sub, state.pendingCheckId);
  const base = { fromSubconceptId: state.subconceptId, toSubconceptId: state.subconceptId, checkId: state.pendingCheckId };

  if (!sub || !check) {
    return {
      decision: { ...base, action: "complete", reason: "All subconcepts are finished.", strategyId: null },
      state,
    };
  }
  const strategyId = sub.strategies[state.strategyIndex]?.id ?? null;
  const stay = (action: Decision["action"], reason: string): PolicyResult => ({
    decision: { ...base, action, reason, strategyId },
    state,
  });

  if (a.intent === "repeat") return stay("repeat", `Student asked to hear that again${a.slower ? ", more slowly" : ""}; replaying the last thing said. Progress unchanged.`);
  if (a.intent === "question") return stay("answer_question", "Student asked a question; answering it and keeping the same question open. Progress unchanged.");
  if (a.intent === "off_topic") return stay("redirect", "Student went off-topic; steering back. Progress unchanged.");
  if (a.intent === "unclear") return stay("clarify", "Couldn't make out an answer; asking the student to try again. Progress unchanged.");

  const sidx = c.subconcepts.findIndex((s) => s.id === sub.id);
  const prog = state.progress[sub.id];
  const said = a.intent === "dont_know" ? "said they don't know" : `answered "${describeExtracted(a.extracted)}"`;
  const key = describeAnswer(check.answer);

  // ----- correct -----
  if (a.intent === "answer" && a.correct) {
    const inARow = state.correctInARow + 1;
    const fixedNow = state.lastMisconception && sub.misconceptions.some((m) => m.id === state.lastMisconception) ? state.lastMisconception : null;
    const updated: SubconceptProgress = {
      ...prog,
      checksAttempted: prog.checksAttempted + 1,
      checksCorrect: prog.checksCorrect + 1,
      fixed: fixedNow ? addUnique(prog.fixed, fixedNow) : prog.fixed,
    };
    const need = sub.mastery.correctInARow;
    const celebrate = fixedNow ? { misconceptionId: fixedNow } : null;
    const fixedText = fixedNow ? ` They got right the kind of question they missed earlier (${fixedNow}).` : "";
    state = { ...state, streak: state.streak + 1, lastMisconception: null };

    // Retention check from an earlier session: one correct answer is enough.
    if (state.review) {
      const kept: SessionState = {
        ...state,
        review: null,
        progress: { ...state.progress, [sub.id]: { ...updated, reviewsPassed: prog.reviewsPassed + 1 } },
      };
      const back = getSubconcept(c, state.review.returnTo);
      const reason = `Retention check on "${sub.title}": student ${said}, which matches the key (${key}), so they still remember it.`;
      if (!back) return moveOn(c, kept, sidx, { ...base, action: "advance", reason, strategyId, celebrate });
      const entered = enterSubconcept(kept, back);
      return {
        decision: { ...base, action: "advance", reason: `${reason} Continuing with "${back.title}".`, toSubconceptId: back.id, checkId: entered.pendingCheckId, strategyId: back.strategies[0].id, celebrate },
        state: entered,
      };
    }

    if (inARow < need) {
      const { check: nextCheck, used } = pickNextCheck(sub, state.usedCheckIds, check.id);
      return {
        decision: {
          ...base,
          action: "next_check",
          strategyId,
          checkId: nextCheck.id,
          reason: `Student ${said}, which matches the key (${key}).${fixedText} ${inARow}/${need} correct in a row — one more check before calling it mastered.`,
          celebrate,
        },
        state: { ...state, correctInARow: inARow, pendingCheckId: nextCheck.id, usedCheckIds: used, progress: { ...state.progress, [sub.id]: updated } },
      };
    }

    const mastered: SessionState = {
      ...state,
      correctInARow: inARow,
      progress: { ...state.progress, [sub.id]: { ...updated, status: "mastered" } },
    };
    return moveOn(c, mastered, sidx, {
      ...base,
      action: "advance",
      reason: `Student ${said}, which matches the key (${key}).${fixedText} ${inARow}/${need} correct in a row → "${sub.title}" mastered.`,
      strategyId,
      celebrate,
    });
  }

  // ----- wrong, or don't know -----
  const why = a.intent === "dont_know" ? `Student ${said}` : `Student ${said}, but the answer is ${key}`;
  const mis = sub.misconceptions.find((m) => m.id === a.misconceptionId);
  const misText = mis ? ` Likely misconception: ${mis.id}.` : "";
  const attempted: SubconceptProgress = {
    ...prog,
    checksAttempted: prog.checksAttempted + 1,
    misconceptions: mis ? { ...prog.misconceptions, [mis.id]: (prog.misconceptions[mis.id] ?? 0) + 1 } : prog.misconceptions,
  };
  state = { ...state, streak: 0, lastMisconception: mis?.id ?? state.lastMisconception };

  // Failed retention check: the topic is no longer mastered; re-teach it now, then carry on.
  let reviewText = "";
  if (state.review) {
    attempted.status = "in_progress";
    attempted.reviewsFailed = prog.reviewsFailed + 1;
    reviewText = ` Retention check on "${sub.title}" failed, so it is no longer counted as mastered.`;
    state = { ...state, review: null };
  }

  if (state.reteachesHere >= sub.mastery.maxReteaches) {
    const flagged: SessionState = {
      ...state,
      correctInARow: 0,
      progress: { ...state.progress, [sub.id]: { ...attempted, status: "needs_review" } },
    };
    return moveOn(c, flagged, sidx, {
      ...base,
      action: "move_on_flagged",
      reason: `${why}.${misText} Already re-taught ${state.reteachesHere} times with different strategies; flagging "${sub.title}" for review instead of looping, and moving on.`,
      strategyId,
    });
  }

  const nextStrategyIndex = pickReteachStrategy(sub, state.strategyIndex, a.misconceptionId, prog.strategiesUsed);
  const nextStrategy = sub.strategies[nextStrategyIndex];
  const targeted = !!a.misconceptionId && nextStrategy.targets.includes(a.misconceptionId);
  const { check: nextCheck, used } = pickNextCheck(sub, state.usedCheckIds, check.id);
  return {
    decision: {
      ...base,
      action: "reteach",
      strategyId: nextStrategy.id,
      checkId: nextCheck.id,
      reason: `${why}.${misText}${reviewText} Strategy "${sub.strategies[state.strategyIndex].name}" didn't land, so re-teaching with "${nextStrategy.name}"${targeted ? ` (it targets ${a.misconceptionId})` : ""} and checking again with a fresh question (re-teach ${state.reteachesHere + 1}/${sub.mastery.maxReteaches}).`,
    },
    state: {
      ...state,
      strategyIndex: nextStrategyIndex,
      correctInARow: 0,
      reteachesHere: state.reteachesHere + 1,
      pendingCheckId: nextCheck.id,
      usedCheckIds: used,
      progress: {
        ...state.progress,
        [sub.id]: { ...attempted, reteachCount: prog.reteachCount + 1, strategiesUsed: addUnique(prog.strategiesUsed, nextStrategy.id) },
      },
    },
  };
}

/**
 * Re-teach with a different strategy. Never the current one; prefer, in order:
 * untried and targets the misconception → untried → targets the misconception → next in order.
 */
function pickReteachStrategy(sub: Subconcept, current: number, misconceptionId: string | null, tried: string[]): number {
  const others = sub.strategies.map((_, i) => i).filter((i) => i !== current);
  const untried = (i: number) => !tried.includes(sub.strategies[i].id);
  const targets = (i: number) => !!misconceptionId && sub.strategies[i].targets.includes(misconceptionId);
  return (
    others.find((i) => untried(i) && targets(i)) ??
    others.find(untried) ??
    others.find(targets) ??
    (current + 1) % sub.strategies.length
  );
}

function moveOn(c: Curriculum, state: SessionState, fromIndex: number, d: Omit<Decision, "toSubconceptId" | "checkId">): PolicyResult {
  const next = nextOpenSubconcept(c, state, fromIndex);
  if (!next) {
    return {
      decision: { ...d, action: "complete", reason: `${d.reason} That was the last topic.`, toSubconceptId: null, checkId: null },
      state: { ...state, subconceptId: null, pendingCheckId: null, usedCheckIds: [] },
    };
  }
  const entered = enterSubconcept(state, next);
  return {
    decision: { ...d, reason: `${d.reason} Next: "${next.title}".`, toSubconceptId: next.id, checkId: entered.pendingCheckId, strategyId: next.strategies[0].id },
    state: entered,
  };
}
