import type Database from 'better-sqlite3';

/** Mirrors @space/environment's BootstrapStatus (spec section 8.1, ONB-001). */
export type BootstrapRunStatus =
  | 'not_started'
  | 'scanning'
  | 'plan_ready'
  | 'installing'
  | 'verification_required'
  | 'partially_complete'
  | 'complete'
  | 'blocked';

/** Mirrors @space/environment's StepState (spec section 8.6, ONB-006). */
export type BootstrapStepState =
  | 'pending'
  | 'running'
  | 'successful'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'needs_restart';

/** Mirrors @space/environment's ReceiptOutcome (spec section 8.8, ONB-008). */
export type BootstrapReceiptOutcome =
  | 'installed_by_space'
  | 'already_present'
  | 'updated_by_space'
  | 'user_cancelled'
  | 'partially_installed'
  | 'needs_manual_remediation';

export interface BootstrapRunRow {
  readonly id: string;
  readonly status: BootstrapRunStatus;
  readonly platform: string;
  readonly planJson: unknown;
  readonly blockReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewBootstrapRunRow {
  readonly id: string;
  readonly status: BootstrapRunStatus;
  readonly platform: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BootstrapStepRow {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly toolId: string | null;
  readonly state: BootstrapStepState;
  readonly humanExplanation: string;
  readonly commandDisplayRedacted: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly redactedOutput: string | null;
  readonly retryEligible: boolean;
  readonly changedMachineState: boolean;
  readonly outcome: BootstrapReceiptOutcome | null;
  readonly operationId: string | null;
}

export interface UpsertBootstrapStepRow {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly toolId: string | null;
  readonly state: BootstrapStepState;
  readonly humanExplanation: string;
  readonly commandDisplayRedacted: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly redactedOutput: string | null;
  readonly retryEligible: boolean;
  readonly changedMachineState: boolean;
  readonly outcome: BootstrapReceiptOutcome | null;
  readonly operationId: string | null;
}

interface SqliteBootstrapRunRow {
  id: string;
  status: BootstrapRunStatus;
  platform: string;
  plan_json: string | null;
  block_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface SqliteBootstrapStepRow {
  id: string;
  run_id: string;
  sequence: number;
  tool_id: string | null;
  state: BootstrapStepState;
  human_explanation: string;
  command_display_redacted: string | null;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  redacted_output: string | null;
  retry_eligible: number;
  changed_machine_state: number;
  outcome: BootstrapReceiptOutcome | null;
  operation_id: string | null;
}

function runFromSqlite(row: SqliteBootstrapRunRow): BootstrapRunRow {
  return {
    id: row.id,
    status: row.status,
    platform: row.platform,
    planJson: row.plan_json ? JSON.parse(row.plan_json) : null,
    blockReason: row.block_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stepFromSqlite(row: SqliteBootstrapStepRow): BootstrapStepRow {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    toolId: row.tool_id,
    state: row.state,
    humanExplanation: row.human_explanation,
    commandDisplayRedacted: row.command_display_redacted,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    redactedOutput: row.redacted_output,
    retryEligible: row.retry_eligible === 1,
    changedMachineState: row.changed_machine_state === 1,
    outcome: row.outcome,
    operationId: row.operation_id,
  };
}

/**
 * Pure data access over `bootstrap_runs` and `bootstrap_steps` (spec
 * section 8, M3). This is the durable backing store for the resumable
 * ONB-001 state machine: a run's `status` and its steps' terminal state
 * survive application restart, so `getLatestRun` is how the app decides
 * what to resume after a crash, restart, or lost network mid-install.
 */
export class BootstrapRepository {
  constructor(private readonly db: Database.Database) {}

  createRun(input: NewBootstrapRunRow): BootstrapRunRow {
    this.db
      .prepare(
        `INSERT INTO bootstrap_runs (id, status, platform, plan_json, block_reason, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(input.id, input.status, input.platform, input.createdAt, input.updatedAt);
    const created = this.findRunById(input.id);
    if (!created) {
      throw new Error(`Bootstrap run ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  findRunById(id: string): BootstrapRunRow | null {
    const row = this.db.prepare('SELECT * FROM bootstrap_runs WHERE id = ?').get(id) as
      | SqliteBootstrapRunRow
      | undefined;
    return row ? runFromSqlite(row) : null;
  }

  /** Most recently created run, or null if bootstrap has never started. */
  getLatestRun(): BootstrapRunRow | null {
    const row = this.db
      .prepare('SELECT * FROM bootstrap_runs ORDER BY created_at DESC LIMIT 1')
      .get() as SqliteBootstrapRunRow | undefined;
    return row ? runFromSqlite(row) : null;
  }

  updateStatus(
    id: string,
    status: BootstrapRunStatus,
    updatedAt: string,
    blockReason: string | null = null,
  ): BootstrapRunRow {
    this.db
      .prepare('UPDATE bootstrap_runs SET status = ?, block_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, blockReason, updatedAt, id);
    const updated = this.findRunById(id);
    if (!updated) {
      throw new Error(`Bootstrap run ${id} vanished while updating status`);
    }
    return updated;
  }

  savePlan(id: string, plan: unknown, updatedAt: string): BootstrapRunRow {
    this.db
      .prepare('UPDATE bootstrap_runs SET plan_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(plan), updatedAt, id);
    const updated = this.findRunById(id);
    if (!updated) {
      throw new Error(`Bootstrap run ${id} vanished while saving plan`);
    }
    return updated;
  }

  listSteps(runId: string): BootstrapStepRow[] {
    const rows = this.db
      .prepare('SELECT * FROM bootstrap_steps WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as SqliteBootstrapStepRow[];
    return rows.map(stepFromSqlite);
  }

  /** Insert-or-update by (run_id, sequence) so re-running a step overwrites its prior record. */
  upsertStep(input: UpsertBootstrapStepRow): BootstrapStepRow {
    this.db
      .prepare(
        `INSERT INTO bootstrap_steps
           (id, run_id, sequence, tool_id, state, human_explanation, command_display_redacted,
            started_at, ended_at, exit_code, redacted_output, retry_eligible, changed_machine_state,
            outcome, operation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, sequence) DO UPDATE SET
           id = excluded.id,
           tool_id = excluded.tool_id,
           state = excluded.state,
           human_explanation = excluded.human_explanation,
           command_display_redacted = excluded.command_display_redacted,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           exit_code = excluded.exit_code,
           redacted_output = excluded.redacted_output,
           retry_eligible = excluded.retry_eligible,
           changed_machine_state = excluded.changed_machine_state,
           outcome = excluded.outcome,
           operation_id = excluded.operation_id`,
      )
      .run(
        input.id,
        input.runId,
        input.sequence,
        input.toolId,
        input.state,
        input.humanExplanation,
        input.commandDisplayRedacted,
        input.startedAt,
        input.endedAt,
        input.exitCode,
        input.redactedOutput,
        input.retryEligible ? 1 : 0,
        input.changedMachineState ? 1 : 0,
        input.outcome,
        input.operationId,
      );
    const row = this.db
      .prepare('SELECT * FROM bootstrap_steps WHERE run_id = ? AND sequence = ?')
      .get(input.runId, input.sequence) as SqliteBootstrapStepRow | undefined;
    if (!row) {
      throw new Error(`Bootstrap step ${input.runId}/${input.sequence} vanished after upsert`);
    }
    return stepFromSqlite(row);
  }
}
