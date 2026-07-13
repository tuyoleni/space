import type Database from 'better-sqlite3';

/**
 * Bytes of serialised `partialState` retained per operation receipt before
 * truncation (spec 27.4's resource-limit requirement — an operation that
 * captures a huge stdout/stderr blob on failure must not grow the
 * database unbounded). Kept in lockstep with `@space/domain`'s
 * `RESOURCE_LIMITS.maxRetainedOperationOutputBytes` by convention, not by
 * importing it (this package stays dependency-light on purpose).
 */
export const MAX_RETAINED_OPERATION_OUTPUT_BYTES = 64 * 1024;

function truncatePartialStateJson(json: string): string {
  if (Buffer.byteLength(json, 'utf-8') <= MAX_RETAINED_OPERATION_OUTPUT_BYTES) {
    return json;
  }
  // A crude but safe truncation: keep the payload wrapped in valid JSON so
  // every reader can still `JSON.parse` it, with an explicit marker rather
  // than silently losing the tail without a trace.
  const truncated = Buffer.from(json, 'utf-8').subarray(0, MAX_RETAINED_OPERATION_OUTPUT_BYTES).toString('utf-8');
  return JSON.stringify({ truncated: true, maxBytes: MAX_RETAINED_OPERATION_OUTPUT_BYTES, preview: truncated });
}

export type OperationRisk = 'observe' | 'local-reversible' | 'remote' | 'destructive';

export type OperationState =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'partially_succeeded';

export interface OperationRow {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly type: string;
  readonly risk: OperationRisk;
  readonly state: OperationState;
  readonly humanSummary: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly partialState: unknown;
}

export interface NewOperationRow {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly type: string;
  readonly risk: OperationRisk;
  readonly humanSummary: string;
  readonly startedAt: string;
}

export interface OperationCompletion {
  readonly state: Exclude<OperationState, 'running'>;
  readonly endedAt: string;
  readonly exitCode: number | null;
  readonly partialState?: unknown;
}

export interface NewOperationStepRow {
  readonly id: string;
  readonly operationId: string;
  readonly sequence: number;
  readonly type: string;
  readonly state: string;
  readonly commandDisplayRedacted: string | null;
  readonly resultSummary: string | null;
}

interface SqliteOperationRow {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  type: string;
  risk: OperationRisk;
  state: OperationState;
  human_summary: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  partial_state_json: string | null;
}

function fromSqlite(row: SqliteOperationRow): OperationRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    type: row.type,
    risk: row.risk,
    state: row.state,
    humanSummary: row.human_summary,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    partialState: row.partial_state_json ? JSON.parse(row.partial_state_json) : null,
  };
}

/**
 * Pure data access over `operations` and `operation_steps` (spec sections
 * 23.2.7, 23.2.8) — the durable receipt every mutating command must leave
 * behind (spec section 33, "every mutating command has a corresponding
 * receipt").
 */
export class OperationRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): OperationRow | null {
    const row = this.db.prepare('SELECT * FROM operations WHERE id = ?').get(id) as
      | SqliteOperationRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByWorkspace(workspaceId: string): OperationRow[] {
    const rows = this.db
      .prepare('SELECT * FROM operations WHERE workspace_id = ? ORDER BY started_at DESC')
      .all(workspaceId) as SqliteOperationRow[];
    return rows.map(fromSqlite);
  }

  start(input: NewOperationRow): OperationRow {
    this.db
      .prepare(
        `INSERT INTO operations
           (id, workspace_id, project_id, type, risk, state, human_summary, started_at, ended_at, exit_code, partial_state_json)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, NULL, NULL)`,
      )
      .run(input.id, input.workspaceId, input.projectId, input.type, input.risk, input.humanSummary, input.startedAt);
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Operation ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  complete(id: string, completion: OperationCompletion): OperationRow {
    const partialStateJson =
      completion.partialState !== undefined ? truncatePartialStateJson(JSON.stringify(completion.partialState)) : null;
    this.db
      .prepare(
        `UPDATE operations SET state = ?, ended_at = ?, exit_code = ?, partial_state_json = ? WHERE id = ?`,
      )
      .run(completion.state, completion.endedAt, completion.exitCode, partialStateJson, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Operation ${id} vanished while completing`);
    }
    return updated;
  }

  addStep(input: NewOperationStepRow): void {
    this.db
      .prepare(
        `INSERT INTO operation_steps (id, operation_id, sequence, type, state, command_display_redacted, result_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.operationId,
        input.sequence,
        input.type,
        input.state,
        input.commandDisplayRedacted,
        input.resultSummary,
      );
  }
}
