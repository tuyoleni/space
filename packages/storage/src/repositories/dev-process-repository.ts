import type Database from 'better-sqlite3';

export type DevProcessState = 'running' | 'stopped' | 'crashed';

export interface DevProcessRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandDisplay: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly state: DevProcessState;
  readonly detectedUrl: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly operationId: string | null;
}

export interface NewDevProcessRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandDisplay: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly startedAt: string;
  readonly operationId: string | null;
}

interface SqliteDevProcessRow {
  id: string;
  workspace_id: string;
  project_id: string;
  command_display: string;
  cwd: string;
  pid: number | null;
  state: DevProcessState;
  detected_url: string | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  operation_id: string | null;
}

function fromSqlite(row: SqliteDevProcessRow): DevProcessRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    commandDisplay: row.command_display,
    cwd: row.cwd,
    pid: row.pid,
    state: row.state,
    detectedUrl: row.detected_url,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    operationId: row.operation_id,
  };
}

/**
 * Pure data access over `dev_processes` (PRJ-006, spec section 10.6): the
 * durable process record a launched dev server is attached to, so stop/
 * restart and "preserve workspace ownership after switching context" have
 * somewhere durable to read pid/state/URL from rather than living only in
 * main-process memory.
 */
export class DevProcessRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewDevProcessRow): DevProcessRow {
    this.db
      .prepare(
        `INSERT INTO dev_processes
           (id, workspace_id, project_id, command_display, cwd, pid, state, detected_url, started_at, ended_at, exit_code, operation_id)
         VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, ?, NULL, NULL, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.projectId,
        input.commandDisplay,
        input.cwd,
        input.pid,
        input.startedAt,
        input.operationId,
      );
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Dev process ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  findById(id: string): DevProcessRow | null {
    const row = this.db.prepare('SELECT * FROM dev_processes WHERE id = ?').get(id) as
      | SqliteDevProcessRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByProject(projectId: string): DevProcessRow[] {
    const rows = this.db
      .prepare('SELECT * FROM dev_processes WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as SqliteDevProcessRow[];
    return rows.map(fromSqlite);
  }

  setDetectedUrl(id: string, url: string): DevProcessRow {
    this.db.prepare('UPDATE dev_processes SET detected_url = ? WHERE id = ?').run(url, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Dev process ${id} vanished while recording its detected URL`);
    }
    return updated;
  }

  markStopped(id: string, state: 'stopped' | 'crashed', exitCode: number | null, endedAt: string): DevProcessRow {
    this.db
      .prepare('UPDATE dev_processes SET state = ?, exit_code = ?, ended_at = ? WHERE id = ?')
      .run(state, exitCode, endedAt, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Dev process ${id} vanished while marking it stopped`);
    }
    return updated;
  }

  /** Mirrors TerminalSessionRepository.reconcileOrphanedSessions: no dev server survives an app restart. */
  reconcileOrphanedProcesses(reconciledAt: string): number {
    const result = this.db
      .prepare("UPDATE dev_processes SET state = 'stopped', ended_at = ? WHERE state = 'running'")
      .run(reconciledAt);
    return result.changes;
  }
}
