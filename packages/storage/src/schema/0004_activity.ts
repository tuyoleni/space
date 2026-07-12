/**
 * Activity event schema (spec 23.2.9 ActivityEvent, section 17). Additive
 * migration (ADR-003): never edit 0001-0003 once shipped.
 *
 * `weight` is a REAL, not an INTEGER: spec 17.2 requires the grid to
 * distinguish intensity by "event count or weighted meaningful activity"
 * rather than raw count alone, and @space/activity's operation mapping
 * assigns fractional weights (e.g. 0.5 for a workspace switch).
 */
export const MIGRATION_0004_ACTIVITY = `
CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  subject_ref TEXT,
  summary TEXT NOT NULL,
  weight REAL NOT NULL,
  metadata_json TEXT
);
CREATE INDEX idx_activity_events_workspace_occurred ON activity_events(workspace_id, occurred_at);
`;
