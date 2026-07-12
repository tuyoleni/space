/**
 * ONB-006/ONB-008: installation progress, verification, receipts (spec
 * sections 8.6-8.8).
 *
 * This module never spawns a real installer itself — `runInstaller` and
 * `verify` are injected, so every behaviour here (skip-if-satisfied,
 * cancellation, the "installer said 0 but verification disagrees"
 * classification) is provable with fakes and involves zero real system
 * mutation (spec section 33).
 */
import { RedactionRegistry } from '@space/workspace-runner';
import type { CommandExecutionResult, PlannedStep, ReceiptOutcome, ScanToolResult, StepExecutionRecord, VerificationOutcome } from './types';

const MAX_OUTPUT_LENGTH = 64 * 1024;

export interface ExecuteStepOptions {
  readonly runInstaller: (step: PlannedStep) => Promise<CommandExecutionResult>;
  readonly verify: (toolId: string) => Promise<VerificationOutcome>;
  readonly redaction?: RedactionRegistry;
  /** Checked immediately before running the installer, and not after — a step that starts always reaches a terminal state. */
  readonly isCancelled?: () => boolean;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_LENGTH ? `${text.slice(0, MAX_OUTPUT_LENGTH)}\n[truncated]` : text;
}

function commandDisplay(step: PlannedStep, redaction: RedactionRegistry): string | null {
  if (!step.strategy) {
    return null;
  }
  return redaction.redact(`${step.strategy.executable} ${step.strategy.args.join(' ')}`);
}

/**
 * Executes one planned step against its prior scan result and an injected
 * installer runner + verifier. Skips steps that are already satisfied
 * (outcome `already_present`) without running anything. Steps with
 * `deferredImplementation: true` (spec: shell integration, owned by a
 * later milestone) are always skipped, never silently marked successful.
 *
 * Verification is unconditional: even when the installer exits 0, the
 * step is only `successful` if `options.verify` independently agrees
 * (spec section 39: never treat installer exit code zero as complete
 * verification).
 */
export async function executeStep(
  step: PlannedStep,
  priorScan: ScanToolResult | undefined,
  options: ExecuteStepOptions,
): Promise<StepExecutionRecord> {
  const redaction = options.redaction ?? new RedactionRegistry();
  const display = commandDisplay(step, redaction);

  if (step.deferredImplementation) {
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: 'skipped',
      humanExplanation: step.humanExplanation,
      commandDisplay: display,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: null,
    };
  }

  if (step.kind === 'prerequisite-check' || step.kind === 'verify-only') {
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: 'skipped',
      humanExplanation: step.humanExplanation,
      commandDisplay: display,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: step.toolId ? 'already_present' : null,
    };
  }

  if (priorScan?.found && priorScan.meetsMinimumVersion !== false) {
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: 'skipped',
      humanExplanation: `${step.displayName} is already present and meets the minimum version.`,
      commandDisplay: display,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: 'already_present',
    };
  }

  if (options.isCancelled?.()) {
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: 'cancelled',
      humanExplanation: step.humanExplanation,
      commandDisplay: display,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: true,
      changedMachineState: false,
      outcome: 'user_cancelled',
    };
  }

  if (!step.strategy) {
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: 'failed',
      humanExplanation: `${step.displayName} has no available install strategy on this platform.`,
      commandDisplay: display,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: 'needs_manual_remediation',
    };
  }

  const startedAt = new Date().toISOString();
  const installResult = await options.runInstaller(step);
  const redactedOutput = truncate(redaction.redact(`${installResult.stdout}\n${installResult.stderr}`));
  const endedAt = new Date().toISOString();

  // The critical requirement (spec section 39): verification is run and
  // trusted regardless of installResult.exitCode.
  const verification = step.toolId ? await options.verify(step.toolId) : null;

  if (verification?.verified) {
    const outcome: ReceiptOutcome = priorScan?.found ? 'updated_by_space' : 'installed_by_space';
    return {
      stepId: step.id,
      toolId: step.toolId,
      state: verification.needsRestart ? 'needs_restart' : 'successful',
      humanExplanation: step.humanExplanation,
      commandDisplay: display,
      startedAt,
      endedAt,
      exitCode: installResult.exitCode,
      redactedOutput,
      retryEligible: false,
      changedMachineState: true,
      outcome,
    };
  }

  // Installer may have exited 0 here — that alone never earns 'successful'.
  const failureReason = verification?.failureReason ?? 'Verification could not run.';
  const outcome: ReceiptOutcome =
    installResult.exitCode === 0 ? 'partially_installed' : 'needs_manual_remediation';

  return {
    stepId: step.id,
    toolId: step.toolId,
    state: 'failed',
    humanExplanation: `${step.humanExplanation} Verification failed: ${failureReason}`,
    commandDisplay: display,
    startedAt,
    endedAt,
    exitCode: installResult.exitCode,
    redactedOutput,
    retryEligible: true,
    changedMachineState: installResult.exitCode === 0,
    outcome,
  };
}

/** Runs every step in `plan.steps` in order, stopping early only on user cancellation. */
export async function executePlanSteps(
  steps: readonly PlannedStep[],
  scanTools: readonly ScanToolResult[],
  options: ExecuteStepOptions,
): Promise<StepExecutionRecord[]> {
  const records: StepExecutionRecord[] = [];
  for (const step of steps) {
    const prior = step.toolId ? scanTools.find((t) => t.toolId === step.toolId) : undefined;
    const record = await executeStep(step, prior, options);
    records.push(record);
    if (record.state === 'cancelled') {
      break;
    }
  }
  return records;
}
