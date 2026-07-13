import type Database from 'better-sqlite3';

/**
 * Pure data access over `agent_standing_permissions` (spec 19.2.3/19.2.4,
 * added M7). A row here can only ever satisfy the confirmation gate for
 * `remote`-risk agent actions — see `assertAgentActionConfirmed` in
 * `@space/domain`, which never lets any standing permission substitute
 * for a `destructive` action's confirmation.
 */
export interface AgentStandingPermissionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

export interface NewAgentStandingPermissionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
  readonly grantedAt: string;
}

interface SqliteAgentStandingPermissionRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  action_type: string;
  granted_at: string;
  revoked_at: string | null;
}

function fromSqlite(row: SqliteAgentStandingPermissionRow): AgentStandingPermissionRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    actionType: row.action_type,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

export class AgentPermissionRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): AgentStandingPermissionRow | null {
    const row = this.db
      .prepare('SELECT * FROM agent_standing_permissions WHERE id = ?')
      .get(id) as SqliteAgentStandingPermissionRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  /** Finds a live (non-revoked) grant for this exact scope, or null. Multiple revoked grants for the same scope may exist — each grant/revoke is its own row, an audit trail rather than an upsert. */
  findActiveGrant(workspaceId: string, projectId: string | null, actionType: string): AgentStandingPermissionRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_standing_permissions
         WHERE workspace_id = ? AND action_type = ? AND revoked_at IS NULL
           AND (project_id IS ? OR project_id = ?)
         ORDER BY granted_at DESC LIMIT 1`,
      )
      .get(workspaceId, actionType, projectId, projectId) as SqliteAgentStandingPermissionRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByWorkspace(workspaceId: string): AgentStandingPermissionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_standing_permissions WHERE workspace_id = ? ORDER BY granted_at DESC')
      .all(workspaceId) as SqliteAgentStandingPermissionRow[];
    return rows.map(fromSqlite);
  }

  grant(input: NewAgentStandingPermissionRow): AgentStandingPermissionRow {
    this.db
      .prepare(
        `INSERT INTO agent_standing_permissions (id, workspace_id, project_id, action_type, granted_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(input.id, input.workspaceId, input.projectId, input.actionType, input.grantedAt);
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`AgentStandingPermission ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  /** Idempotent: revoking an already-revoked (or nonexistent) grant is a no-op, never an error. */
  revoke(id: string, revokedAt: string): void {
    this.db
      .prepare('UPDATE agent_standing_permissions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(revokedAt, id);
  }
}
