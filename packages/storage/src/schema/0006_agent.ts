/**
 * Agent standing permissions (spec 19.2.3/19.2.4, added M7). Additive
 * migration (ADR-003): never edit 0001-0005 once shipped.
 *
 * A standing permission is narrow (one `action_type`, scoped to a
 * `workspace_id` and optionally a `project_id`) and revocable
 * (`revoked_at`) — it can only ever satisfy the confirmation gate for
 * `remote`-risk agent actions (`assertAgentActionConfirmed` in
 * `@space/domain`); destructive actions always require fresh confirmation
 * regardless of any row in this table (spec 19.2.4: "destructive actions
 * require confirmation every time").
 */
export const MIGRATION_0006_AGENT = `
CREATE TABLE agent_standing_permissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_agent_standing_permissions_workspace_id ON agent_standing_permissions(workspace_id);
CREATE INDEX idx_agent_standing_permissions_scope ON agent_standing_permissions(workspace_id, project_id, action_type);
`;
