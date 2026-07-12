/**
 * Bootstrap (computer onboarding) schema (spec section 8, M3). Never edit
 * 0001_init.ts once shipped — new schema changes are additive migrations
 * (ADR-003).
 *
 * `bootstrap_runs` persists the ONB-001 state machine so it survives
 * application restart, system restart, and lost network. `bootstrap_steps`
 * persists the per-step fields required by ONB-006 (state, explanation,
 * command, timestamps, redacted output, exit code, retry eligibility,
 * whether the step changed machine state) plus the ONB-008 receipt outcome
 * classification. `operation_id` links a step to the generic operations
 * ledger (spec section 33) without duplicating its columns.
 */
export const MIGRATION_0002_BOOTSTRAP = `
CREATE TABLE bootstrap_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  platform TEXT NOT NULL,
  plan_json TEXT,
  block_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bootstrap_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES bootstrap_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  tool_id TEXT,
  state TEXT NOT NULL,
  human_explanation TEXT NOT NULL,
  command_display_redacted TEXT,
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  redacted_output TEXT,
  retry_eligible INTEGER NOT NULL DEFAULT 0,
  changed_machine_state INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  operation_id TEXT REFERENCES operations(id) ON DELETE SET NULL
);
CREATE INDEX idx_bootstrap_steps_run_id ON bootstrap_steps(run_id);
CREATE UNIQUE INDEX idx_bootstrap_steps_run_sequence ON bootstrap_steps(run_id, sequence);
`;
