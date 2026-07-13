import type Database from 'better-sqlite3';

/**
 * Pure data access over `automations` (spec 18.1, added M8). `trigger`/
 * `conditions`/`actions` are stored as JSON exactly as `@space/automation`'s
 * already-validated `AutomationTrigger`/`AutomationCondition[]`/
 * `AutomationAction[]` shapes — this repository re-parses JSON but never
 * re-validates domain semantics; that happens once, before a row is ever
 * written, via `parseAutomationDefinition`/`parseAutomationAction`.
 */
export interface AutomationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly trigger: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly enabled: boolean;
  readonly lastExecutionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewAutomationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly trigger: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly createdAt: string;
}

interface SqliteAutomationRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  trigger_json: string;
  conditions_json: string;
  actions_json: string;
  enabled: number;
  last_execution_id: string | null;
  created_at: string;
  updated_at: string;
}

function fromSqlite(row: SqliteAutomationRow): AutomationRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    trigger: JSON.parse(row.trigger_json),
    conditions: JSON.parse(row.conditions_json),
    actions: JSON.parse(row.actions_json),
    enabled: row.enabled === 1,
    lastExecutionId: row.last_execution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewAutomationRow): AutomationRow {
    this.db
      .prepare(
        `INSERT INTO automations
           (id, workspace_id, project_id, name, trigger_json, conditions_json, actions_json, enabled, last_execution_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.projectId,
        input.name,
        JSON.stringify(input.trigger),
        JSON.stringify(input.conditions),
        JSON.stringify(input.actions),
        input.createdAt,
        input.createdAt,
      );
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Automation ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  findById(id: string): AutomationRow | null {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as SqliteAutomationRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByWorkspace(workspaceId: string): AutomationRow[] {
    const rows = this.db
      .prepare('SELECT * FROM automations WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as SqliteAutomationRow[];
    return rows.map(fromSqlite);
  }

  setEnabled(id: string, enabled: boolean, updatedAt: string): AutomationRow {
    this.db.prepare('UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, updatedAt, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Automation ${id} vanished while toggling enabled`);
    }
    return updated;
  }

  setLastExecutionId(id: string, lastExecutionId: string, updatedAt: string): void {
    this.db.prepare('UPDATE automations SET last_execution_id = ?, updated_at = ? WHERE id = ?').run(lastExecutionId, updatedAt, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }
}
