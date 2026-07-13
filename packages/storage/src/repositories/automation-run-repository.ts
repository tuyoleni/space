import type Database from 'better-sqlite3';

export type AutomationRunState = 'running' | 'succeeded' | 'failed' | 'skipped-disabled' | 'skipped-conditions';

export interface AutomationRunRow {
  readonly id: string;
  readonly automationId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly triggerType: string;
  readonly triggerEvent: unknown;
  readonly state: AutomationRunState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly operationId: string | null;
  readonly failureReason: string | null;
  readonly attempts: number;
}

export interface NewAutomationRunRow {
  readonly id: string;
  readonly automationId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly triggerType: string;
  readonly triggerEvent: unknown;
  readonly startedAt: string;
  readonly operationId?: string | null;
}

export interface AutomationRunCompletion {
  readonly state: Exclude<AutomationRunState, 'running'>;
  readonly endedAt: string;
  readonly failureReason?: string | null;
  readonly attempts: number;
}

interface SqliteAutomationRunRow {
  id: string;
  automation_id: string;
  workspace_id: string;
  project_id: string | null;
  trigger_type: string;
  trigger_event_json: string;
  state: AutomationRunState;
  started_at: string;
  ended_at: string | null;
  operation_id: string | null;
  failure_reason: string | null;
  attempts: number;
}

function fromSqlite(row: SqliteAutomationRunRow): AutomationRunRow {
  return {
    id: row.id,
    automationId: row.automation_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    triggerType: row.trigger_type,
    triggerEvent: JSON.parse(row.trigger_event_json),
    state: row.state,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    operationId: row.operation_id,
    failureReason: row.failure_reason,
    attempts: row.attempts,
  };
}

/**
 * Retained run history per automation (spec 27.4's resource-limit
 * requirement applied to automation execution history, the same way
 * `ActivityRepository`'s retention window applies to activity events) —
 * kept in lockstep with `@space/domain`'s `RESOURCE_LIMITS` by convention,
 * not by importing it (this package stays dependency-light; see that
 * module's header for the established reasoning).
 */
export const MAX_RETAINED_RUNS_PER_AUTOMATION = 200;

/**
 * Pure data access over `automation_runs` — the durable receipt every
 * automation run produces (spec 18.1 "Execution history", 18.4 "each run
 * produces a receipt").
 */
export class AutomationRunRepository {
  constructor(private readonly db: Database.Database) {}

  start(input: NewAutomationRunRow): AutomationRunRow {
    this.db
      .prepare(
        `INSERT INTO automation_runs
           (id, automation_id, workspace_id, project_id, trigger_type, trigger_event_json, state, started_at, ended_at, operation_id, failure_reason, attempts)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, ?, NULL, 0)`,
      )
      .run(
        input.id,
        input.automationId,
        input.workspaceId,
        input.projectId,
        input.triggerType,
        JSON.stringify(input.triggerEvent),
        input.startedAt,
        input.operationId ?? null,
      );
    this.pruneOldRuns(input.automationId);
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Automation run ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  complete(id: string, completion: AutomationRunCompletion): AutomationRunRow {
    this.db
      .prepare('UPDATE automation_runs SET state = ?, ended_at = ?, failure_reason = ?, attempts = ? WHERE id = ?')
      .run(completion.state, completion.endedAt, completion.failureReason ?? null, completion.attempts, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Automation run ${id} vanished while completing`);
    }
    return updated;
  }

  findById(id: string): AutomationRunRow | null {
    const row = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as SqliteAutomationRunRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByAutomation(automationId: string, limit = MAX_RETAINED_RUNS_PER_AUTOMATION): AutomationRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(automationId, limit) as SqliteAutomationRunRow[];
    return rows.map(fromSqlite);
  }

  /** Enforces `MAX_RETAINED_RUNS_PER_AUTOMATION` (spec 27.4) — deletes the oldest rows beyond the cap every time a new run is started, so history never grows unbounded. */
  pruneOldRuns(automationId: string, keep: number = MAX_RETAINED_RUNS_PER_AUTOMATION): number {
    const result = this.db
      .prepare(
        `DELETE FROM automation_runs
         WHERE automation_id = ?
           AND id NOT IN (
             SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?
           )`,
      )
      .run(automationId, automationId, keep);
    return result.changes;
  }
}
