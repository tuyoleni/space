/**
 * Terminal session and development-process schema (M4, spec sections
 * 15.4/23.2.3 TERM-004, 10.6 PRJ-006). Additive migration (ADR-003): never
 * edit 0001/0002 once shipped.
 *
 * `terminal_sessions` persists TERM-004's lifecycle fields so restarted
 * sessions can be shown as history even though the live PTY process itself
 * cannot be assumed recoverable across an application restart (spec 15.4).
 *
 * `dev_processes` is the durable process record PRJ-006 requires for a
 * launched development server: pid, detected URL, and state so stop/
 * restart and "preserve ownership across a workspace switch" all have
 * somewhere durable to read from. `operation_id` links to the generic
 * receipt ledger without duplicating its columns, matching how
 * `bootstrap_steps` links to `operations` in 0002.
 */
export const MIGRATION_0003_TERMINAL_AND_DEV_PROCESS = `
CREATE TABLE terminal_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  shell TEXT NOT NULL,
  cwd TEXT NOT NULL,
  pid INTEGER,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  last_output_at TEXT
);
CREATE INDEX idx_terminal_sessions_workspace_id ON terminal_sessions(workspace_id);

CREATE TABLE dev_processes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command_display TEXT NOT NULL,
  cwd TEXT NOT NULL,
  pid INTEGER,
  state TEXT NOT NULL,
  detected_url TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL
);
CREATE INDEX idx_dev_processes_project_id ON dev_processes(project_id);
`;
