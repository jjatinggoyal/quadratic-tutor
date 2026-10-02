-- Quadratic Tutor schema. See DESIGN.md §1 for the reasoning.

CREATE TABLE students (
  id           TEXT PRIMARY KEY,           -- random id kept in the browser's localStorage
  display_name TEXT,
  created_at   INTEGER NOT NULL            -- epoch ms
);

-- Long-lived, per-student mastery. Keyed by stable subconcept id (not position),
-- so reordering or inserting subconcepts doesn't corrupt progress.
CREATE TABLE subconcept_progress (
  student_id       TEXT NOT NULL REFERENCES students(id),
  subconcept_id    TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('not_started','in_progress','mastered','needs_review')),
  checks_attempted INTEGER NOT NULL DEFAULT 0,
  checks_correct   INTEGER NOT NULL DEFAULT 0,
  reteach_count    INTEGER NOT NULL DEFAULT 0,
  strategies_used  TEXT NOT NULL DEFAULT '[]',  -- JSON array of strategy ids tried
  first_seen_at    INTEGER,
  mastered_at      INTEGER,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (student_id, subconcept_id)
);

-- One sitting. state_json is the engine's full SessionState snapshot, which is
-- what makes resume exact (pending question, strategy index, board).
CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  student_id         TEXT NOT NULL REFERENCES students(id),
  status             TEXT NOT NULL CHECK (status IN ('active','completed')),
  curriculum_id      TEXT NOT NULL,
  curriculum_version TEXT NOT NULL,
  state_json         TEXT NOT NULL,
  turn_count         INTEGER NOT NULL DEFAULT 0,   -- also the optimistic-concurrency version
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_sessions_student ON sessions (student_id, updated_at DESC);

-- Append-only event log: one row per tutor turn. This is the history, the
-- audit trail for every decision, and the observability source.
CREATE TABLE turns (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  seq                 INTEGER NOT NULL,
  client_turn_id      TEXT,                  -- idempotency key from the browser
  created_at          INTEGER NOT NULL,
  -- input
  student_text        TEXT,                  -- NULL for the tutor's opening turn
  input_source        TEXT,                  -- 'browser_stt' | 'server_stt' | 'typed' | NULL
  -- where the student was
  subconcept_id       TEXT,
  check_id            TEXT,
  -- what the tutor concluded
  intent              TEXT,
  correct             INTEGER,               -- 1 / 0 / NULL when not an answer
  misconception_id    TEXT,
  assessment_json     TEXT,
  -- what the tutor decided, and why
  action              TEXT NOT NULL,
  reason              TEXT NOT NULL,
  next_subconcept_id  TEXT,
  next_check_id       TEXT,
  strategy_id         TEXT,
  -- what the tutor did
  tutor_speech        TEXT NOT NULL,
  board_ops_json      TEXT NOT NULL,
  -- versions, for attributing quality changes
  prompt_version      TEXT NOT NULL,
  curriculum_version  TEXT NOT NULL,
  assessor_model      TEXT,
  responder_model     TEXT,
  -- performance / reliability
  assessor_ms         INTEGER,
  responder_ms        INTEGER,
  total_ms            INTEGER NOT NULL,
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  degraded            INTEGER NOT NULL DEFAULT 0,   -- 1 if any fallback path was used
  llm_attempts_json   TEXT,
  client_timings_json TEXT,                  -- STT / TTS timings reported by the browser
  UNIQUE (session_id, seq),
  UNIQUE (session_id, client_turn_id)
);
CREATE INDEX idx_turns_created ON turns (created_at);
CREATE INDEX idx_turns_session ON turns (session_id, seq);
