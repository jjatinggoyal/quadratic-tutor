-- Sessions that end, retention checks, misconception tracking, and simulated
-- students (so insights can include or exclude them). See DESIGN.md §1.

-- Per-topic memory of the student's mistakes and how they did on warm-up checks.
ALTER TABLE subconcept_progress ADD COLUMN misconceptions  TEXT    NOT NULL DEFAULT '{}';  -- JSON {misconception_id: count}
ALTER TABLE subconcept_progress ADD COLUMN fixed           TEXT    NOT NULL DEFAULT '[]';  -- JSON [misconception_id] later answered correctly
ALTER TABLE subconcept_progress ADD COLUMN reviews_passed  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subconcept_progress ADD COLUMN reviews_failed  INTEGER NOT NULL DEFAULT 0;

-- A session now ends after inactivity, so "session 3" is real.
ALTER TABLE sessions ADD COLUMN session_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN end_reason     TEXT;   -- 'finished' | 'inactive' | 'restarted'

ALTER TABLE turns ADD COLUMN is_review           INTEGER NOT NULL DEFAULT 0;  -- answer to a retention check
ALTER TABLE turns ADD COLUMN fixed_misconception TEXT;                         -- set when the student overcame an earlier mistake

ALTER TABLE students ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_turns_action ON turns (action, created_at);
