import type Database from 'better-sqlite3';

export type TerminalSessionState = 'running' | 'exited';

export interface TerminalSessionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly state: TerminalSessionState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly lastOutputAt: string | null;
}

export interface NewTerminalSessionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly startedAt: string;
}

interface SqliteTerminalSessionRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  shell: string;
  cwd: string;
  pid: number | null;
  state: TerminalSessionState;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  last_output_at: string | null;
}

function fromSqlite(row: SqliteTerminalSessionRow): TerminalSessionRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    shell: row.shell,
    cwd: row.cwd,
    pid: row.pid,
    state: row.state,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    lastOutputAt: row.last_output_at,
  };
}

/**
 * Pure data access over `terminal_sessions` (spec sections 15.4 TERM-004,
 * 23.2.3). Persists lifecycle metadata only — never raw PTY output (spec
 * 15.5) — so a restarted application can show terminal history without
 * ever having retained anything a user typed or a process printed.
 */
export class TerminalSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewTerminalSessionRow): TerminalSessionRow {
    this.db
      .prepare(
        `INSERT INTO terminal_sessions
           (id, workspace_id, project_id, shell, cwd, pid, state, started_at, ended_at, exit_code, last_output_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL)`,
      )
      .run(input.id, input.workspaceId, input.projectId, input.shell, input.cwd, input.pid, input.startedAt);
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Terminal session ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  findById(id: string): TerminalSessionRow | null {
    const row = this.db.prepare('SELECT * FROM terminal_sessions WHERE id = ?').get(id) as
      | SqliteTerminalSessionRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByWorkspace(workspaceId: string): TerminalSessionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM terminal_sessions WHERE workspace_id = ? ORDER BY started_at ASC')
      .all(workspaceId) as SqliteTerminalSessionRow[];
    return rows.map(fromSqlite);
  }

  recordOutput(id: string, lastOutputAt: string): void {
    this.db.prepare('UPDATE terminal_sessions SET last_output_at = ? WHERE id = ?').run(lastOutputAt, id);
  }

  markExited(id: string, exitCode: number | null, endedAt: string): TerminalSessionRow {
    this.db
      .prepare("UPDATE terminal_sessions SET state = 'exited', exit_code = ?, ended_at = ? WHERE id = ?")
      .run(exitCode, endedAt, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Terminal session ${id} vanished while marking it exited`);
    }
    return updated;
  }

  /**
   * TERM-004: "live PTY processes cannot be assumed recoverable" across an
   * application restart. Call once at startup so any row left `running`
   * from a previous process (which no longer exists) is represented
   * honestly as history rather than a phantom "still running" session.
   */
  reconcileOrphanedSessions(reconciledAt: string): number {
    const result = this.db
      .prepare("UPDATE terminal_sessions SET state = 'exited', ended_at = ? WHERE state = 'running'")
      .run(reconciledAt);
    return result.changes;
  }
}
