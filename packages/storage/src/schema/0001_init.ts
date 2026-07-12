/**
 * Baseline schema (spec section 23.2): workspaces, projects, and the
 * operation/receipt tables. Column names match the spec's entity field
 * lists exactly so repositories map 1:1 without hidden renames.
 */
export const MIGRATION_0001_INIT = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_token TEXT,
  default_project_directory TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  filesystem_identity TEXT,
  repository_root TEXT,
  trust_state TEXT NOT NULL DEFAULT 'untrusted',
  detected_type_json TEXT NOT NULL DEFAULT '[]',
  remote_json TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE UNIQUE INDEX idx_projects_workspace_path ON projects(workspace_id, canonical_path);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  risk TEXT NOT NULL,
  state TEXT NOT NULL,
  human_summary TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  partial_state_json TEXT
);
CREATE INDEX idx_operations_workspace_id ON operations(workspace_id);

CREATE TABLE operation_steps (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  command_display_redacted TEXT,
  result_summary TEXT
);
CREATE INDEX idx_operation_steps_operation_id ON operation_steps(operation_id);
`;
