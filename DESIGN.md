# DESIGN

The tutor is a **deterministic teaching policy with two LLMs on either side of it**:

```
student speech ──STT──► text ──► ASSESSOR (LLM) ──► grader (code) ──► POLICY (code) ──► RESPONDER (LLM) ──► speech + board ──TTS──►
                                 "what did they say?"   "is it right?"   "what next, and why?"  "say it well"
```

The LLM never decides whether an answer is right or whether to move on. The assessor extracts what the student said into a structured value. The grader compares it to the curriculum's answer key. The policy (`src/core/policy.ts`, a pure function) picks the next action and writes the reason. The responder only phrases an action that has already been decided. This split is what makes the loop testable, explainable ("why did the tutor do that?" is a stored string built from facts) and resilient (every stage has a non-LLM fallback).

---

## 1. Data model

D1 (SQLite), four tables. Full DDL: `migrations/0001_init.sql` and `0002_sessions_memory_insights.sql`.

```
students            (id PK, display_name, is_simulated, created_at)
subconcept_progress (student_id, subconcept_id, status, checks_attempted, checks_correct,
                     reteach_count, strategies_used JSON,
                     misconceptions JSON {id: count}, fixed JSON [id],        -- the student's own mistakes
                     reviews_passed, reviews_failed,                          -- retention checks
                     first_seen_at, mastered_at, updated_at)
                     PK (student_id, subconcept_id)
sessions            (id PK, student_id, session_number, status active|completed,
                     end_reason finished|inactive|restarted, curriculum_id, curriculum_version,
                     state_json, turn_count, created_at, updated_at)
turns               (id PK, session_id, seq, client_turn_id, created_at,
                     student_text, input_source,                     -- what came in
                     subconcept_id, check_id,                        -- where the student was
                     intent, correct, misconception_id, assessment_json,   -- what we concluded
                     action, reason, next_subconcept_id, next_check_id, strategy_id,  -- what we decided, and why
                     tutor_speech, board_ops_json,                   -- what we did
                     prompt_version, curriculum_version, assessor_model, responder_model,
                     assessor_ms, responder_ms, total_ms, tokens_in, tokens_out,
                     degraded, llm_attempts_json, client_timings_json,
                     is_review, fixed_misconception)
                     UNIQUE (session_id, seq), UNIQUE (session_id, client_turn_id)
```

**Why this shape**

- **Progress lives in two places on purpose, with one owner each.** `subconcept_progress` is the long-lived answer to "what does this student know?". It spans sessions and is what the progress rail shows. `sessions.state_json` is the engine's full working state (`SessionState` in `src/core/types.ts`): current subconcept, pending question, which strategy we're on, how many re-teaches, the board. Resume is exact because we restore that snapshot, not reconstruct it. The state also holds the tutor's memory: its last four decisions with their reasons, so it can truthfully answer "why did we move on?"; the streak; and the last misconception, so a later correct answer on that kind of question is recognised as a fix.
- **A session is one sitting.** It closes after 30 minutes of inactivity (`end_reason = inactive`), on "start over" (`restarted`), or when the curriculum is done (`finished`). Session N+1 is seeded from `subconcept_progress`. It opens with a **retention check**: one question from the most recently mastered topic, after which the student continues at the first unmastered topic. A failed check un-masters the topic and re-teaches it.
- **Misconceptions are counted per student and per topic, not just logged per turn.** That powers the end-of-topic recap ("remember: x − 3 = 0 gives +3"), the "you fixed it" moment, and the insights page.
- **`turns` is an append-only event log**, one row per tutor turn. It is the conversation history (the prompts read the last few rows), the audit trail for every decision (`action` + `reason`), and the observability source. I denormalised the fields I expect to query (`intent`, `correct`, `action`, `degraded`, latencies, versions) into columns, and kept the full payloads as JSON.
- **Everything is keyed by stable string IDs** (`factorisation`, `fa_nonmonic`, `sign_check`), never by position. That is what lets the curriculum change under a student (§2).
- **Status is a small state machine:** `not_started → in_progress → mastered | needs_review`. Mastery is 2 correct in a row. `needs_review` means the student was still wrong after 2 re-teaches with different strategies, so we flag the topic and move on rather than loop.
- **Concurrency and idempotency.** Every turn carries a browser-generated `client_turn_id`. A retry after a network error returns the stored turn instead of applying it twice. All writes for a turn go in one D1 batch (a transaction). `UNIQUE(session_id, seq)` makes a racing second tab fail with a 409 instead of silently forking the session.

What I'd add with real users: a `curriculum_versions` table instead of versions living only in code, and an `events` table for client-side events (mic denied, TTS interrupted, tab hidden).

## 2. Iterability

Three kinds of change, and what each does to a student halfway through session 3 (sessions really are numbered now; see §1):

| Change | Where it lives | Effect on an in-flight student |
|---|---|---|
| **Prompt** | `src/core/prompts.ts`, `PROMPT_VERSION` | Takes effect on their next turn. Nothing to migrate: prompts read the state, they don't own it. Every turn row records `prompt_version`, so quality can be compared before and after the change. |
| **Model** | `wrangler.jsonc` `vars` (`MODEL_ASSESSOR`, `MODEL_RESPONDER`, `MODEL_FALLBACK`) | Same: next turn. Models are config, not code. `assessor_model` / `responder_model` are recorded per turn. |
| **Curriculum** | `src/core/curriculum/quadratics.ts`, `version` | On load, `rebaseState()` reconciles the saved state with the new curriculum. Progress is kept by subconcept ID. Removed subconcepts are dropped. New ones appear as `not_started`. If the student's current subconcept or pending question still exists, they carry on exactly where they were. If not, they restart that subconcept cleanly (fresh question, first strategy). They never land on a question that no longer exists. |

The rule that makes this safe: **never reuse an ID for different content.** If a question's meaning changes, it gets a new ID. The curriculum lint (`npm run lint:curriculum`) checks ID uniqueness, verifies every answer key by evaluating the equation, and rejects teaching material that contains a check's equation.

**Rolling out a change**

1. `npm run eval` against the change locally. The suite exits non-zero on any regression versus `evals/baseline.json`. For a model swap, run it with the model overridden, e.g. `MODEL_RESPONDER=… npm run eval`. This is how I picked the current models: `gpt-5.4-mini` as responder regressed two scenarios, and so did `gpt-5.4-nano` as assessor.
2. `npm run sim` to check multi-turn behaviour (e.g. a persona that stops progressing).
3. Deploy with Workers gradual deployments. The previous version keeps serving most traffic while the new one takes a small percentage. Watch the per-version dashboards (§3) split by `prompt_version`.
4. **Rollback** is `wrangler rollback`. It is safe because state is forward- and backward-compatible: the old code reads the same `state_json`, and `rebaseState` handles both directions of a curriculum change.

What's missing for real scale (listed in §6): pinning a session to the versions it started with, for A/B tests where you want a whole session on one arm.

## 3. Observability

**Per turn** we log one structured line to Workers Logs (`event: "turn"`) and the same data to the `turns` table:

- **Inputs:** input source (browser STT / server STT / typed); client-reported STT time and how long the previous TTS took.
- **Assessment:** intent, extracted answer, correct, misconception, and whether it came from the LLM or the heuristic fallback.
- **Decision:** action, human-readable reason, from/to subconcept, strategy, next check.
- **Output:** speech and board ops, plus ops the sanitiser dropped (writes to reserved lines, highlights of missing IDs).
- **Reliability:** every LLM attempt (model, ms, error: `timeout`, `http_503`, `schema_invalid`, `rejected: …`), `degraded`, tokens.
- **Versions:** `prompt_version`, `curriculum_version`, models.

**What I'd alert on**

| Signal | Why | Threshold (starting point) |
|---|---|---|
| `degraded` turn rate | The student is getting canned lessons | > 2% over 10 min |
| p90 `total_ms` | Voice feels broken above ~5 s | > 6 s over 10 min |
| Assessor `intent = unclear` rate | STT or the assessor is failing; students are being asked to repeat themselves | > 15%, or 2× the 7-day baseline |
| Leak-guard rejections (`rejected:` attempts) | The responder is drifting toward giving answers away | 2× baseline |
| Sessions stuck: ≥ 3 `reteach` in a row with no `next_check` | The loop, not the student, is failing | spike vs baseline |
| LLM spend against the key's limit | When the limit is hit, every turn silently becomes a canned "degraded" lesson. This happened during development: the eval suite with a `gpt-5.4` judge costs about $1 per full run. | 80% of budget |

**Finding out the tutor got worse before a student tells you**

1. **Before deploy:** the eval suite. Deterministic checks catch grading and loop regressions. The LLM judge catches pedagogy regressions such as re-teaching by repeating the rule, leaking the next answer, or praising a wrong answer. It is run 3× per scenario, and a scenario passes at 2 of 3 runs, so model noise doesn't produce false alarms.
2. **After deploy, from logs (no labels needed):** compare these per `prompt_version` / model:
   - re-teach success rate: P(correct on the check right after a re-teach)
   - checks-to-mastery per subconcept
   - `needs_review` rate
   - unclear/clarify rate

   A worse explainer shows up as lower re-teach success within hours.
3. **Continuous:** a nightly job that samples ~50 real turns and runs the same LLM judge rubric on them. That becomes a quality time series you can alert on.
4. **Canary sims:** `npm run sim -- --api <prod> --sessions 3` on a schedule. It drives the real deployment as flagged simulated students, across sessions, so it also exercises retention checks. The `gradedRight` column checks grading against the simulated student's own stated answer, so a regression in the assessor shows up as a drop there.

**Where to look:** `/insights` turns the turn log into the views above, with real and simulated traffic separable:
- re-teach success, overall and per strategy
- mastery funnel and most common misconceptions (with how often they were fixed)
- hardest questions, with an "unclear" rate that flags confusing wording
- retention, and where abandoned sessions stopped
- intent mix, and accuracy, re-teach and degraded rates per prompt and model version
- latency by stage

## 4. Latency

Where the time goes in one voice turn (measured over 120 simulated turns against OpenRouter, assessor model at the time `gemini-3.1-flash-lite`, responder `gpt-5.4`; approximate, from a single location):

| Stage | p50 | p90 | Notes |
|---|---|---|---|
| End-of-speech detection | ~0.5–1.2 s | | Browser STT's own endpointing; server-STT mode waits 1.2 s of silence |
| STT | ~0 s (browser) / ~1.5–3 s (server) | | Browser STT streams, so the transcript is ready at end of speech |
| Assessor LLM | 1.2 s | 1.9 s | ~300 output tokens max |
| Policy + DB | < 50 ms | | |
| Responder LLM | 2.6 s | 3.6 s | ~1.3k tokens in, ~150 out |
| **Server total** | **3.8 s** | **4.8 s** | |
| TTS start | ~0.1–0.3 s | | `speechSynthesis`, sentence by sentence |

So a student waits roughly 4–5 s from finishing speaking to hearing the tutor. The two LLM calls are serial by design: the responder needs the decision, and the decision needs the grade.

**What I'd do, in order of perceived impact per effort:**

1. **Stream the responder and speak the first sentence as soon as it arrives.** This cuts perceived latency by about the responder's generation time (≈ 1.5–2 s). It needs the speech to come before the board ops in the output. A streaming JSON parser, or two fields in a fixed order, makes that easy.
2. **An instant, decision-aware acknowledgement.** After the assessor and policy (~1.3 s) we already know the outcome. Say a short pre-recorded or TTS phrase ("Not quite — let's look at it another way…", "That's right!") while the responder generates. The student hears something relevant in ~1.5 s. The board already shows the question and title immediately.
3. **Skip the assessor when it isn't needed.** Many replies are trivially parseable ("yes", "3 and minus 4"). The heuristic extractor already exists. Use it when it gives a confident result, and call the LLM only for the rest. This saves ~1.2 s on a large share of turns.
4. **Speculative responder.** For yes/no and choice questions, start "correct" and "wrong" responses in parallel with the assessor and discard the loser. This costs roughly 2× tokens and saves ~1.2 s.
5. **Model and region.** A faster responder (the evals say `gpt-5.4-mini` is ~0.9 s faster but weaker on "why" questions) could be routed per action: the cheap model for `next_check` / `redirect` / `clarify`, the strong one for `reteach` / `answer_question`.

The UI already hides some of this: the pending question is on the board, "Tara is thinking…" shows immediately, and the student can barge in by tapping the mic while the tutor talks.

## 5. Metrics

**The one I'd look at first: re-teach success rate.** It is the percentage of re-teaches after which the student answers the next, fresh question correctly. It measures the core promise of the product, "when you don't get it, I'll explain it differently until you do", and it is directly attributable to the tutor rather than to the student's starting level. It is also computable from the `turns` table with no labelling:

```sql
-- P(correct on the next graded answer | this turn was a re-teach), per prompt version
WITH graded AS (
  SELECT session_id, seq, action, correct, prompt_version,
         LEAD(correct) OVER (PARTITION BY session_id ORDER BY seq) AS next_correct
  FROM turns WHERE intent = 'answer' OR action = 'reteach')
SELECT prompt_version, AVG(next_correct) AS reteach_success, COUNT(*) AS n
FROM graded WHERE action = 'reteach' AND next_correct IS NOT NULL GROUP BY prompt_version;
```

**The rest of the dashboard:**

- **Learning:** mastery rate per subconcept; checks-to-mastery; `needs_review` rate per subconcept (a subconcept with a high rate is a curriculum problem, not a student problem); retention (on a new session, does a mastered topic's first check still come back correct?).
- **Engagement:** sessions per student per week; turns per session; drop-off point, i.e. which subconcept and action the last turn of abandoned sessions was on. A cluster of drop-offs right after `reteach` means the explanations are frustrating.
- **Tutor quality:** judge pass rate on sampled turns; `clarify` rate (proxy for STT and assessor quality); answer-leak guard rejections.
- **Experience:** p50/p90 time-to-first-audio; degraded-turn rate; mic-permission-denied rate; share of typed versus spoken input (a high typed share means voice isn't working for people).
- **Cost:** tokens and dollars per mastered subconcept, which is the unit that matters.

The North Star for the business is weekly students reaching mastery on a new subconcept. Re-teach success is the leading indicator I'd watch daily. It is the headline number on `/insights`, next to per-strategy success, which tells you which explanation to improve. Retention (warm-up pass rate on later sessions) is the check that "mastered" means something.

## 6. What's ugly

What I'd fix with another two days, roughly in priority order:

1. **Latency** (§4). Streaming the responder plus a decision-aware acknowledgement is the biggest UX win, and it isn't done.
2. **Grading is all-or-nothing.** "x = 3" for a two-root equation, or a correctly set up word problem with no final number, is simply wrong. A real tutor would say "good, what's the other root?". I'd add a `partial` outcome to the grader and a `hint` action to the policy, so the student can finish their own answer before the tutor re-teaches.
3. **The answer-leak guard is heuristic.** It catches the upcoming equation, its sign-flipped copies, and word-problem numbers on the board. It does not catch leaks in speech, or a different equation with the same roots. Speech leaks are covered only by the prompt and the judge. A real fix would check the responder's speech against the pending answer key with the same grader.
4. **Sessions aren't pinned to versions.** A prompt or model change applies to everyone on their next turn. That's fine for a prototype, but proper A/B tests need `session.prompt_version` / `session.model_set`, chosen at session start.
5. **The simulator's student doesn't always follow its directive** (the `obeyed` column: 71–100%). Grading accuracy is measured against the student's own stated answer, so the metric is still sound, but personas are noisier than they should be.
6. **The eval suite is single-turn.** Multi-turn behaviours (does the second re-teach differ from the first? does the tutor stop repeating itself?) are only visible in sims, not in pass/fail checks. I'd promote a few sim transcripts into scripted multi-turn scenarios.
7. **Voice is browser-grade.** `speechSynthesis` voices vary a lot by OS, and there is no voice-activity detection or barge-in during browser TTS beyond tapping the mic. Server STT fallback works but has ~2 s extra latency. OpenRouter has no TTS models, so better TTS means adding a provider.
8. **No auth.** The student ID is a random ID in `localStorage`, and anyone with a session ID can read its decision log. That's fine for a demo, not for children's data. Add accounts, and scope `/api/session/:id/log` to its owner.
9. **The board highlight is a substring match on LaTeX.** If the LLM highlights a term that spans braces, it falls back to highlighting the whole line. A structured board (steps and terms as IDs, rendered from a tree) would make "highlight the −5x in step 2" exact.
10. **Circuit-breaker state is per isolate.** Each Worker isolate learns about an outage separately. Moving it to a Durable Object or KV would make fallback kick in faster during a provider incident.
11. **`/insights` is public and computed live.** Fine at this scale. With real traffic it needs auth and pre-aggregated tables (a nightly rollup), not window functions over every turn.
12. **Memory is shallow.** The tutor remembers 4 decisions. The retention check asks one question from one topic. The streak resets each session. Spaced review across all mastered topics (weighted by time since mastery and past mistakes) is the obvious next step.
13. **The evals are expensive to run often.** About $1 per full run with a `gpt-5.4` judge. I'd use a cheaper judge for routine runs, keep the strong judge for release gates, and run only the deterministic scenarios on every commit.
