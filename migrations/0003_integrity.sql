-- Integrity fixes from code review. See DESIGN.md §1.

-- The exact response returned for a turn, so an idempotent retry replays it
-- verbatim (it was being rebuilt from the session's *current* state).
ALTER TABLE turns ADD COLUMN view_json TEXT;

-- At most one active session per student. First close any duplicates that
-- concurrent session starts could have created, keeping the most recent.
UPDATE sessions SET status = 'completed', end_reason = 'restarted'
WHERE status = 'active'
  AND id NOT IN (
    SELECT s.id FROM sessions s
    WHERE s.status = 'active'
      AND s.updated_at = (SELECT MAX(s2.updated_at) FROM sessions s2 WHERE s2.student_id = s.student_id AND s2.status = 'active'));
CREATE UNIQUE INDEX one_active_session_per_student ON sessions (student_id) WHERE status = 'active';

CREATE INDEX idx_sessions_active_updated ON sessions (status, updated_at);
