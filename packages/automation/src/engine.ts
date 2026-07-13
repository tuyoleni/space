/**
 * The automation execution engine (spec 18.1, 18.4). Owns none of its own
 * persistence or capabilities — every dependency is injected, mirroring
 * every other privileged package in this codebase (`GitExecutor`,
 * `GhExecutor`, `ModelProvider`, ...). This module is responsible for
 * exactly four things spec 18.4 makes non-negotiable:
 *
 * 1. A disabled kill switch stops execution before any action runs, and is
 *    re-checked before every subsequent action in a multi-action run, so
 *    disabling automations takes effect immediately even mid-run.
 * 2. Every run produces a receipt: `runs.start`/`runs.complete` is called
 *    unconditionally, including for a run skipped by the kill switch or a
 *    failed condition — "each run produces a receipt" (spec 18.4) does not
 *    say "each successful run".
 * 3. Failed actions retry a bounded number of times (`AutomationRetryPolicy`)
 *    and then the whole run stops — never an unbounded loop, and never a
 *    fallback that silently skips to the next action after exhausting
 *    retries (an automation's actions are ordered for a reason; skipping
 *    ahead after a failure could run a later action against state the
 *    earlier one was supposed to establish).
 * 4. Every action is dispatched through `dispatchAutomationAction`, which
 *    is the same structural confirmation gate this package's `dispatch.ts`
 *    documents — this engine never calls a handler directly.
 */
import { dispatchAutomationAction, type AutomationActionHandlers } from './dispatch';
import { DEFAULT_AUTOMATION_RETRY_POLICY, type Automation, type AutomationRetryPolicy, type AutomationRun, type AutomationRunState } from './model';
import { evaluateConditions, isInScope, type AutomationTriggerEvent } from './trigger-matching';
import type { AgentStandingPermission } from '@space/domain';

export interface AutomationRunStartInput {
  readonly automationId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly triggerEvent: AutomationTriggerEvent;
  readonly startedAt: string;
}

export interface AutomationRunCompleteInput {
  readonly state: Exclude<AutomationRunState, 'running'>;
  readonly endedAt: string;
  readonly failureReason?: string;
  readonly attempts: number;
}

/** The persistence port this engine needs — a thin wrapper apps/desktop's automation-handlers.ts implements over `AutomationRunRepository` + `withReceipt`. */
export interface AutomationRunRecorder {
  startRun(input: AutomationRunStartInput): Promise<AutomationRun>;
  completeRun(runId: string, completion: AutomationRunCompleteInput): Promise<AutomationRun>;
}

/** Resolves a live standing permission for one exact automation action, scoped to workspace/project (spec 18.4). */
export interface AutomationStandingPermissionLookup {
  findActiveGrant(workspaceId: string, projectId: string | null, actionType: string): Promise<AgentStandingPermission | null>;
}

/**
 * The instant kill switch (spec 18.4: "a user can disable all automations
 * immediately"). Scoped per workspace, matching every other permission
 * surface in this codebase. `isAllEnabled` is checked fresh before every
 * action, not cached, so a toggle takes effect mid-run.
 */
export interface AutomationKillSwitch {
  isAllEnabled(workspaceId: string): Promise<boolean>;
}

export interface AutomationEngineOptions {
  readonly handlers: AutomationActionHandlers;
  readonly runs: AutomationRunRecorder;
  readonly standingPermissions: AutomationStandingPermissionLookup;
  readonly killSwitch: AutomationKillSwitch;
  readonly retryPolicy?: AutomationRetryPolicy;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => string;
}

export type AutomationRunOutcome =
  | { readonly ran: false; readonly reason: 'not-matched' }
  | { readonly ran: true; readonly run: AutomationRun };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AutomationEngine {
  private readonly retryPolicy: AutomationRetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => string;

  constructor(private readonly options: AutomationEngineOptions) {
    this.retryPolicy = options.retryPolicy ?? DEFAULT_AUTOMATION_RETRY_POLICY;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Runs `automation` for `event` if (and only if) it is enabled and in
   * scope (trigger type, workspace, project) — a caller is expected to
   * have already filtered with `inScopeAutomations`, but this re-checks so
   * a stale/incorrect call site can never bypass scoping. Returns
   * `{ ran: false }` without writing any receipt only when the automation
   * was never going to run for this event at all (wrong trigger/scope, or
   * the automation itself is disabled) — nothing happened, nothing to
   * record. Every other path — condition failure, kill switch, real
   * execution — writes a run, deliberately including condition failure:
   * an in-scope automation whose conditions do not pass for this event
   * still gets a `skipped-conditions` receipt (spec 18.1's "Execution
   * history", 18.4's "each run produces a receipt") so a user can see
   * *why* it did not fire, not just silence.
   */
  async runAutomation(automation: Automation, event: AutomationTriggerEvent): Promise<AutomationRunOutcome> {
    if (!automation.enabled || !isInScope(automation, event)) {
      return { ran: false, reason: 'not-matched' };
    }

    const startedAt = this.now();
    const run = await this.options.runs.startRun({
      automationId: automation.id,
      workspaceId: automation.workspaceId,
      projectId: automation.projectId,
      triggerEvent: event,
      startedAt,
    });

    if (!evaluateConditions(automation.conditions, event.context)) {
      const completed = await this.options.runs.completeRun(run.id, {
        state: 'skipped-conditions',
        endedAt: this.now(),
        attempts: 0,
      });
      return { ran: true, run: completed };
    }

    const allEnabled = await this.options.killSwitch.isAllEnabled(automation.workspaceId);
    if (!allEnabled) {
      const completed = await this.options.runs.completeRun(run.id, {
        state: 'skipped-disabled',
        endedAt: this.now(),
        attempts: 0,
      });
      return { ran: true, run: completed };
    }

    let totalAttempts = 0;
    for (const action of automation.actions) {
      // Re-checked before every action, not just once at the top of the run
      // (spec 18.4: disabling automations takes effect immediately).
      const stillEnabled = await this.options.killSwitch.isAllEnabled(automation.workspaceId);
      if (!stillEnabled) {
        const completed = await this.options.runs.completeRun(run.id, {
          state: 'skipped-disabled',
          endedAt: this.now(),
          attempts: totalAttempts,
        });
        return { ran: true, run: completed };
      }

      const standingPermission = await this.options.standingPermissions.findActiveGrant(
        automation.workspaceId,
        automation.projectId,
        action.type,
      );

      let lastError: unknown = null;
      let succeeded = false;
      for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
        totalAttempts += 1;
        try {
          await dispatchAutomationAction(action, this.options.handlers, { standingPermission });
          succeeded = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < this.retryPolicy.maxAttempts) {
            const delay = this.retryPolicy.backoffMs[Math.min(attempt - 1, this.retryPolicy.backoffMs.length - 1)] ?? 0;
            await this.sleep(delay);
          }
        }
      }

      if (!succeeded) {
        const failureReason = lastError instanceof Error ? lastError.message : String(lastError);
        const completed = await this.options.runs.completeRun(run.id, {
          state: 'failed',
          endedAt: this.now(),
          failureReason,
          attempts: totalAttempts,
        });
        return { ran: true, run: completed };
      }
    }

    const completed = await this.options.runs.completeRun(run.id, {
      state: 'succeeded',
      endedAt: this.now(),
      attempts: totalAttempts,
    });
    return { ran: true, run: completed };
  }
}
