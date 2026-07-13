/**
 * Automations, their execution history, and the per-workspace kill switch
 * (spec section 18, added M8). Additive migration (ADR-003): never edit
 * 0001-0006 once shipped.
 *
 * `trigger_json`/`conditions_json`/`actions_json` store the exact,
 * already-Zod-validated shapes `@space/automation`'s `AutomationTrigger`/
 * `AutomationCondition[]`/`AutomationAction[]` define — this table never
 * invents its own parallel schema for them. `automation_runs` is the
 * append-only execution history spec 18.1 requires ("Execution history")
 * and the receipt every run produces (spec 18.4: "each run produces a
 * receipt") — `operation_id` links back to the shared `operations` ledger
 * the same way every other mutating surface in this codebase does.
 * `automation_settings` is the instant, per-workspace kill switch (spec
 * 18.4: "a user can disable all automations immediately") — a dedicated
 * row rather than a column on `workspaces`, so toggling it never touches
 * workspace identity data.
 */
export const MIGRATION_0007_AUTOMATION = `
CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_execution_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_automations_workspace_id ON automations(workspace_id);
CREATE INDEX idx_automations_project_id ON automations(project_id);

CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_event_json TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_automation_runs_automation_id ON automation_runs(automation_id);
CREATE INDEX idx_automation_runs_workspace_id ON automation_runs(workspace_id);

CREATE TABLE automation_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  all_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
`;
