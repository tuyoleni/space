/**
 * First-run bootstrap/onboarding (spec section 8, ONB-001..008): the main-
 * process composition root that wires @space/environment's already-tested
 * scan → platform plan → step orchestrator → verify pipeline to
 * @space/storage's BootstrapRepository (via the storage worker's
 * `bootstrap.*` methods — see storage-handlers.ts) and the ONB-001 state
 * machine (`transition`/`resumeAction`). None of the individual pieces are
 * new logic; this module only sequences them and persists progress after
 * each step so a crash, quit, or lost network mid-install resumes exactly
 * where it left off (spec 8.1) rather than restarting from scratch.
 *
 * One run at a time, app-wide (not per-workspace) — mirrors
 * BootstrapRepository's own schema (no workspace_id column). `buildPlan`
 * is idempotent to call again (e.g. "Rescan"): it always starts a fresh
 * run rather than mutating a stale plan, since the scan itself is cheap
 * and non-mutating (spec 8.2).
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  TOOL_MANIFEST,
  buildMacOsBootstrapPlan,
  buildWindowsBootstrapPlan,
  checkAppleCommandLineTools,
  createNodeScanDependencies,
  executeStep,
  nodeOsInfoPort,
  nodeResolveOnPath,
  nodeRunCommand,
  performScan,
  resumeAction,
  transition,
  verifyTool,
} from '@space/environment';
import type { BootstrapPlan, PlannedStep, ScanResult, StepExecutionRecord } from '@space/environment';
import type { BootstrapStatusResult, BootstrapStepSummary } from '@space/contracts';
import type { StorageCaller } from './project-handlers';

// Mirrors @space/storage's BootstrapRepository row shapes (types.ts:1516's
// "neither package ever enters the renderer bundle directly" applies
// symmetrically here — this main-process module doesn't import
// @space/storage's types either, matching every other *-handlers.ts file's
// convention of only trusting the storage.call<T> generic).
type RunStatus = BootstrapStatusResult['status'];
type StepState = 'pending' | 'running' | 'successful' | 'skipped' | 'failed' | 'cancelled' | 'needs_restart';
type ReceiptOutcome = 'installed_by_space' | 'already_present' | 'updated_by_space' | 'user_cancelled' | 'partially_installed' | 'needs_manual_remediation';

interface RunRow {
  readonly id: string;
  readonly status: RunStatus;
  readonly platform: string;
  readonly planJson: unknown;
  readonly blockReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StepRow {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly toolId: string | null;
  readonly state: StepState;
  readonly humanExplanation: string;
  readonly commandDisplayRedacted: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly redactedOutput: string | null;
  readonly retryEligible: boolean;
  readonly changedMachineState: boolean;
  readonly outcome: ReceiptOutcome | null;
  readonly operationId: string | null;
}

export interface BootstrapHandlers {
  getStatus(): Promise<BootstrapStatusResult>;
  buildPlan(): Promise<BootstrapStatusResult>;
  runNextStep(): Promise<BootstrapStatusResult>;
  cancel(): Promise<BootstrapStatusResult>;
}

function toStepSummary(row: StepRow): BootstrapStepSummary {
  const manifestDisplayName = row.toolId ? TOOL_MANIFEST.entries.find((entry) => entry.id === row.toolId)?.displayName : undefined;
  return {
    toolId: row.toolId,
    displayName: manifestDisplayName ?? row.humanExplanation,
    state: row.state,
    humanExplanation: row.humanExplanation,
    outcome: row.outcome,
  };
}

async function toStatusResult(storage: StorageCaller, run: RunRow | null): Promise<BootstrapStatusResult> {
  if (!run) {
    return { status: 'not_started', resumeAction: 'start_fresh', blockReason: null, steps: [], nextStepIndex: null };
  }
  const rows = await storage.call<StepRow[]>('bootstrap.listSteps', { runId: run.id });
  const steps = rows.map(toStepSummary);
  const nextStepIndex = rows.findIndex((row) => row.state === 'pending');
  return {
    status: run.status,
    resumeAction: resumeAction(run.status),
    blockReason: run.blockReason,
    steps,
    nextStepIndex: nextStepIndex === -1 ? null : nextStepIndex,
  };
}

/** Picks the tool manifest entry a planned step targets — every install/verify-only step has one; prerequisite/shell-integration steps may not. */
function manifestEntryFor(step: PlannedStep) {
  return step.toolId ? TOOL_MANIFEST.entries.find((entry) => entry.id === step.toolId) ?? null : null;
}

export function createBootstrapHandlers(storage: StorageCaller): BootstrapHandlers {
  async function getStatus(): Promise<BootstrapStatusResult> {
    const run = await storage.call<RunRow | null>('bootstrap.getLatestRun', undefined);
    return toStatusResult(storage, run);
  }

  async function buildPlan(): Promise<BootstrapStatusResult> {
    const now = new Date().toISOString();
    const run = await storage.call<RunRow>('bootstrap.createRun', {
      id: randomUUID(),
      status: 'not_started',
      platform: process.platform,
      createdAt: now,
      updatedAt: now,
    });

    const scanning = transition('not_started', { type: 'start_scan' });
    await storage.call('bootstrap.updateStatus', { id: run.id, status: scanning.status, updatedAt: new Date().toISOString() });

    const deps = createNodeScanDependencies(os.homedir());
    const scan: ScanResult = await performScan(TOOL_MANIFEST, deps);

    const plan: BootstrapPlan =
      process.platform === 'win32'
        ? await buildWindowsBootstrapPlan(scan, TOOL_MANIFEST)
        : await buildMacOsBootstrapPlan(scan, TOOL_MANIFEST, {
            appleCommandLineToolsInstalled: await checkAppleCommandLineTools(nodeResolveOnPath),
          });

    await storage.call('bootstrap.savePlan', { id: run.id, plan, updatedAt: new Date().toISOString() });

    if (plan.blocked) {
      const blocked = transition(scanning.status, { type: 'plan_blocked', reason: plan.blockReason ?? 'Bootstrap plan is blocked.' });
      const updated = await storage.call<RunRow>('bootstrap.updateStatus', {
        id: run.id,
        status: blocked.status,
        updatedAt: new Date().toISOString(),
        blockReason: blocked.reason ?? null,
      });
      return toStatusResult(storage, updated);
    }

    // Persist every planned step as `pending` up front so `listSteps` always
    // reflects the full plan, not just steps that have started — the
    // renderer needs the complete list to show "3 of 7" progress before any
    // step has run.
    for (let sequence = 0; sequence < plan.steps.length; sequence += 1) {
      const step = plan.steps[sequence];
      if (!step) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- step rows must land in sequence order, never race.
      await storage.call('bootstrap.upsertStep', {
        id: randomUUID(),
        runId: run.id,
        sequence,
        toolId: step.toolId,
        state: 'pending',
        humanExplanation: step.humanExplanation,
        commandDisplayRedacted: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        redactedOutput: null,
        retryEligible: false,
        changedMachineState: false,
        outcome: null,
        operationId: null,
      });
    }

    const ready = transition(scanning.status, { type: 'scan_complete' });
    const updated = await storage.call<RunRow>('bootstrap.updateStatus', { id: run.id, status: ready.status, updatedAt: new Date().toISOString() });
    return toStatusResult(storage, updated);
  }

  /**
   * Aggregates every step's terminal outcome into the run's final status
   * once nothing is pending. Only `required` manifest entries are ever
   * planned as install steps (macos-plan.ts/windows-plan.ts), so there's
   * no "optional tool failed" case to special-case here — the three-way
   * split is purely on how much of the plan actually succeeded:
   * everything → complete, a mix → partially_complete (retryable), nothing
   * at all → blocked (also retryable, but nothing to build on).
   */
  async function finishInstalling(run: RunRow, rows: readonly StepRow[]): Promise<BootstrapStatusResult> {
    const terminal = transition(run.status, { type: 'all_steps_terminal' });
    const succeeded = (state: StepState) => state === 'successful' || state === 'skipped';
    const allSucceeded = rows.every((row) => succeeded(row.state));
    const anySucceeded = rows.some((row) => succeeded(row.state));
    const event = allSucceeded
      ? ({ type: 'verification_passed' } as const)
      : anySucceeded
        ? ({ type: 'verification_partial' } as const)
        : ({ type: 'verification_failed' } as const);
    const final = transition(terminal.status, event);
    const updated = await storage.call<RunRow>('bootstrap.updateStatus', {
      id: run.id,
      status: final.status,
      updatedAt: new Date().toISOString(),
      blockReason: final.reason ?? null,
    });
    return toStatusResult(storage, updated);
  }

  async function runNextStep(): Promise<BootstrapStatusResult> {
    const run = await storage.call<RunRow | null>('bootstrap.getLatestRun', undefined);
    if (!run || !run.planJson) {
      throw new Error('No bootstrap plan to run — call buildPlan first.');
    }
    const plan = run.planJson as BootstrapPlan;
    const rows = await storage.call<StepRow[]>('bootstrap.listSteps', { runId: run.id });
    const nextIndex = rows.findIndex((row) => row.state === 'pending');
    if (nextIndex === -1) {
      // Nothing pending: either already terminal, or this is the call that
      // discovers the last step just finished — settle the run either way.
      return run.status === 'installing' ? finishInstalling(run, rows) : toStatusResult(storage, run);
    }

    let activeRun = run;
    if (activeRun.status === 'plan_ready') {
      const installing = transition(activeRun.status, { type: 'start_installing' });
      activeRun = await storage.call<RunRow>('bootstrap.updateStatus', { id: activeRun.id, status: installing.status, updatedAt: new Date().toISOString() });
    }

    const step = plan.steps[nextIndex];
    const stepRow = rows[nextIndex];
    if (!step || !stepRow) {
      throw new Error(`Bootstrap plan/step-row mismatch at index ${nextIndex}`);
    }
    const entry = manifestEntryFor(step);
    // Re-derive from the real, current machine state rather than trusting
    // the scan taken when the plan was built — time may have passed, and
    // spec 39 forbids treating a stale/cached signal as "already present".
    const alreadyResolved = entry ? await nodeResolveOnPath(entry.detection[0]?.executable ?? entry.id) : null;
    const priorScan = entry ? { toolId: entry.id, found: alreadyResolved !== null, path: alreadyResolved, version: null, meetsMinimumVersion: null } : undefined;

    const record: StepExecutionRecord = await executeStep(step, priorScan, {
      runInstaller: async (plannedStep) => {
        if (!plannedStep.strategy) {
          return { exitCode: null, stdout: '', stderr: 'No install strategy for this step.' };
        }
        // A rejected spawn (e.g. the strategy's executable isn't a real
        // command on PATH — some `official-installer` strategies are not
        // yet backed by a real download-and-run implementation) must still
        // resolve to a normal failed CommandExecutionResult, the same
        // defensive shape environment-handlers.ts's runToolAction already
        // uses — otherwise executeStep never gets to record the step as
        // `failed` and the raw Node error leaks to the caller instead of a
        // real, upserted (and therefore retryable) step outcome.
        return nodeRunCommand(plannedStep.strategy.executable, plannedStep.strategy.args, { timeoutMs: 180_000 }).catch(
          (error: unknown) => ({ exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }),
        );
      },
      verify: async (toolId) => {
        const verifyEntry = TOOL_MANIFEST.entries.find((candidate) => candidate.id === toolId);
        if (!verifyEntry) {
          return {
            toolId,
            resolved: false,
            resolvedPath: null,
            versionOutput: null,
            version: null,
            meetsMinimumVersion: null,
            functionalCheckPassed: null,
            architectureCompatible: null,
            needsRestart: false,
            verified: false,
            failureReason: `"${toolId}" is not a known manifest entry.`,
          };
        }
        return verifyTool(verifyEntry, { resolveOnPath: nodeResolveOnPath, runCommand: nodeRunCommand, architecture: nodeOsInfoPort.architecture() });
      },
    });

    await storage.call('bootstrap.upsertStep', {
      id: stepRow.id,
      runId: activeRun.id,
      sequence: nextIndex,
      toolId: record.toolId,
      state: record.state,
      humanExplanation: record.humanExplanation,
      commandDisplayRedacted: record.commandDisplay,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      exitCode: record.exitCode,
      redactedOutput: record.redactedOutput,
      retryEligible: record.retryEligible,
      changedMachineState: record.changedMachineState,
      outcome: record.outcome,
      operationId: null,
    });

    const updatedRows = await storage.call<StepRow[]>('bootstrap.listSteps', { runId: activeRun.id });
    const stillPending = updatedRows.some((row) => row.state === 'pending');
    if (!stillPending) {
      return finishInstalling(activeRun, updatedRows);
    }
    return toStatusResult(storage, activeRun);
  }

  async function cancel(): Promise<BootstrapStatusResult> {
    const run = await storage.call<RunRow | null>('bootstrap.getLatestRun', undefined);
    if (!run) {
      return toStatusResult(storage, null);
    }
    const result = transition(run.status, { type: 'user_cancelled' });
    if (!result.allowed) {
      // Not currently installing (e.g. already complete/blocked) — nothing to cancel, current status stands.
      return toStatusResult(storage, run);
    }
    const updated = await storage.call<RunRow>('bootstrap.updateStatus', { id: run.id, status: result.status, updatedAt: new Date().toISOString() });
    return toStatusResult(storage, updated);
  }

  return { getStatus, buildPlan, runNextStep, cancel };
}
