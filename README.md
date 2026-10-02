# Quadratic Tutor

A voice + whiteboard AI tutor for NCERT Class 10 **quadratic equations**. It teaches a concept, checks whether the student actually understood it, and then either moves on or re-teaches differently and checks again. Every decision comes with a stated reason.

**Live:** https://quadratic-tutor.jatingoyal.com. It works best in Chrome or Edge for browser speech recognition. Other browsers fall back to server-side transcription, and typing always works.

- `DESIGN.md`: data model, iterability, observability, latency, metrics, what's ugly.
- Six subconcepts, each with 3 teaching strategies and 5–6 machine-checkable questions: `src/core/curriculum/quadratics.ts`.
- **`/insights`**: what the turn log says. Re-teach success, mastery funnel, which explanations work, common mistakes, hardest questions, retention, drop-off, and per-version quality and latency.

## For the student

- **A proper start.** A new student is greeted instantly (fixed text, no LLM wait). Tara explains how the lesson works and asks if they're ready. The lesson starts when they reply, and "wait" holds it.
- **Talk or type.** Say "repeat that" or "slower please", or tap ↻ Repeat / 🐢 Slower, to hear the last turn again, word for word.
- **Ask anything mid-question.** For example "explain the grouping step again", "what does product mean?", or "why did we move on?". The tutor answers from its real decision log, and the question stays open.
- **Mistakes are remembered.** Each topic ends with a recap that names the student's own slip. Getting that kind of question right later earns a "✨ You fixed it" moment. The progress rail lists each topic's mistakes, which turn green once fixed.
- **Sessions.** After 30 minutes away, the next visit is a new numbered session. It opens with a warm-up question from the last mastered topic, to check it stuck. If it didn't, that topic is re-taught first.
- A streak counter, a decisions panel ("why the tutor did that") and a transcript.

## How a turn works

```
mic ─► STT ─► ASSESSOR (LLM) ─► GRADER (code) ─► POLICY (code) ─► RESPONDER (LLM) ─► speech + board ─► TTS
            what did they say?   is it right?     what next + why    say it, draw it
```

- **STT → LLM → TTS pipeline**, no realtime APIs. STT uses the browser's Web Speech API, or records audio and sends WAV to `/api/stt`. There, Groq Whisper (`whisper-large-v3-turbo`, ~0.2s) transcribes it, with an audio-capable model on OpenRouter as the fallback. TTS uses the browser's `speechSynthesis`, because OpenRouter has no TTS models.
- **Assessor** (`gemini-3.5-flash-lite`): classifies the reply (answer / don't know / question / off-topic / unclear) and extracts the answer. It is prompted for speech-recognition noise ("minus for" → −4) and Hinglish. It never decides correctness.
- **Grader** (`src/core/grader.ts`): compares the extracted answer with the curriculum's answer key. It handles fractions, decimals and unordered root sets.
- **Policy** (`src/core/policy.ts`): a pure function `(state, assessment) → (decision, next state)`.
  - Mastery is 2 correct in a row, then the tutor moves on.
  - A wrong answer or "don't know" triggers a re-teach with a **different strategy**. The policy prefers an untried strategy that targets the detected misconception, then checks again with a fresh question.
  - After 2 re-teaches the topic is flagged `needs_review` and the tutor moves on instead of looping.
  - A question or off-topic reply is answered or redirected, and the same question stays open.
  - The decision's `reason` is shown in the UI's **Decisions** panel and stored per turn.
- **Responder** (`gpt-5.4`): writes the speech and whiteboard operations for the decided action. The system then appends the next question itself, so the right question is always asked.
- **Whiteboard:** `write` / `highlight` / `clear` ops, rendered with KaTeX. A highlight can target a single term inside an equation.

## Failure handling

The LLM provider will time out, return garbage, or go down. Each stage handles this:

| Failure | Handling |
|---|---|
| Timeout | A per-attempt timeout plus an overall budget per call. The same model is not retried after a timeout; the next attempt goes to the fallback model. |
| 5xx / outage | Attempts go primary → primary → **Groq** (`qwen3.8-27b`, a different provider) → `claude-haiku-4.5` on OpenRouter. A circuit breaker skips a model after 3 consecutive failures. |
| Provider out of credit / bad key | A 401, 402 or 403 marks the whole provider down for 5 minutes, so every OpenRouter model is skipped and Groq serves the turn straight away. This isn't hypothetical: the OpenRouter key ran low during development. |
| Garbage / wrong shape | Output is JSON-extracted and schema-validated with zod. A failure counts as a failed attempt. |
| Valid but bad (answer leak) | A semantic validator rejects board content that uses the upcoming question's equation, or a sign-flipped copy of it. The model is retried with feedback. |
| Everything fails | Assessor: a heuristic extractor parses spoken numbers and yes/no, so grading still works. Responder: canned scripts from the curriculum, one per strategy. The turn is marked `degraded` and the UI says so. |
| Network drop on the client | The client retries once with the same `clientTurnId`, so a turn is never applied twice. Manual retry keeps the typed or spoken answer. |
| Browser STT fails | The client switches to server STT automatically. |

The eval suite tests all of these with fault-injecting transports (`evals/fixtures.ts`).

## Running it

```bash
npm install
echo 'OPENROUTER_KEY=sk-or-...' > .env            # used by evals and sims
echo 'GROQ_API_KEY=gsk_...' >> .env                # fallback LLM provider + Whisper STT
cp .env .dev.vars                                  # used by `wrangler dev`
npm run db:migrate:local
npm run dev                                        # builds the SPA and serves Worker + assets on :8787
```

Deploy (Cloudflare Workers + D1 + static assets):

```bash
npx wrangler d1 create quadratic-tutor             # once; put the id in wrangler.jsonc
npx wrangler secret put OPENROUTER_KEY             # once
npx wrangler secret put GROQ_API_KEY               # once
npm run deploy                                     # build → remote migrations → wrangler deploy
```

## Evals: `npm run eval`

34 single-turn scenarios (`evals/scenarios.ts`), each run 3×. A scenario passes at 2 of 3 runs. The command exits 1 on any **regression** versus `evals/baseline.json`.

- **First contact:** the welcome comes first and instantly; "ready" starts the lesson; "wait" holds it; a question in the first reply gets answered.
- **Grading:** STT homophones, Hinglish, a single root given for a two-root equation, working with no final answer, a self-contradicting reply, and the "has x² so it's quadratic" trap.
- **The loop:** a sign error leads to a targeted re-teach; mastery leads to the next topic; "just tell me" leads to a re-teach; a question mid-check keeps the question open; off-topic replies are redirected; a stuck student is flagged and the tutor moves on.
- **Asking for help:** repeat and slower requests replay verbatim with no LLM; a long-winded repeat request; explaining one specific step; "why did you move on?" answered from the real reason.
- **Memory:** celebrating a fixed mistake; a recap that names the mistake; passing and failing a retention check.
- **Resilience:** hung provider, garbage output, primary-model outage, malicious board ops.

Each run checks, deterministically:
- intent, correctness, action, misconception, next topic and progress status
- no LaTeX in speech, and the speech ends by asking the pending question
- word limits, and that every board line is valid KaTeX

Pedagogy (does the re-teach target the actual mistake? does it leak the next answer?) is scored by an LLM judge (`gpt-5.4`), with a rubric per scenario.

The curriculum is linted before every run. The lint verifies each answer key by evaluating the equation, and rejects teaching material that contains a check's equation (`npm run lint:curriculum`).

```bash
npm run eval                                        # compare to baseline
npm run eval -- --only sign-error-reteach --runs 5 --verbose
MODEL_RESPONDER=openai/gpt-5.4-mini npm run eval    # would this model swap regress? (it does: 2 regressions)
M=groq:qwen/qwen3.8-27b MODEL_ASSESSOR=$M MODEL_RESPONDER=$M JUDGE_MODEL=groq:openai/gpt-oss-120b npm run eval
                                                    # how good is the fallback on its own? (25/26; no OpenRouter credit used)
npm run eval -- --update-baseline
```

## Simulations: `npm run sim`

An LLM plays the student and the real engine plays the tutor, for six personas: quick learner, sign-slipper, struggling, distracted, Hinglish speaker, and noisy mic. The noisy-mic persona corrupts replies the way STT does. Each persona's behaviour on each turn (right / wrong / don't know / question / off-topic) is decided in code from its probabilities, and students "learn" after re-teaches. The LLM only voices that behaviour. Otherwise it answers everything correctly.

`npm run sim -- --api <url> --sessions 3` runs the same personas against a **deployed** tutor over HTTP instead. They run as flagged simulated students across several sessions, so return visits and retention checks get exercised too. `/insights` can include or exclude them.

Output is a Markdown transcript plus JSON per session in `sim/out/`, and a summary table:
- mastered / flagged topics, re-teaches and redirects
- `gradedRight`: tutor grading versus the student's own stated answer
- p50/p90 latency

## Layout

```
src/core/        pure TypeScript: runs in the Worker, the evals and the simulator
  curriculum/    the six subconcepts (data)
  engine.ts      one turn: assess → decide → respond; deterministic turns (welcome, resume, repeat)
  policy.ts      the teaching loop (pure)
  respond.ts     board composition, responder context, "why that's right"
  grader.ts      answer checking + heuristic extraction
  intents.ts     replies understood locally ("repeat that", "not yet")
  leak.ts        answer-leak guard;  mathcheck.ts  equation parser (no eval: Workers forbid it)
  canned.ts      fallback scripts;   prompts.ts    prompts + PROMPT_VERSION
  llm.ts         OpenRouter/Groq clients: timeouts, retries with feedback, fallback chain, ProviderHealth
src/worker/      Cloudflare Worker
  index.ts       router;  routes/  session, turn, speech;  db.ts  guarded D1 writes
  views.ts       response shapes;  env.ts  config;  http.ts  validation;  insights.ts  /insights queries
src/web/         React SPA: App (session + turn flow), voice.ts (VoiceLoop), components/, Insights
migrations/      D1 schema
evals/           regression suite, curriculum lint, fault-injecting transports
sim/             simulated students
```
