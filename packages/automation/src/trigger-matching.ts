/**
 * Matches a normalised trigger event against automations (spec 18.2). This
 * module contains no signal detection of its own — `AutomationTriggerEvent`
 * is produced by the caller (apps/desktop's automation-handlers.ts) from
 * signals that already exist: M5's repository watcher `onChangeHint` for
 * `repository-state-changed`, M5's commit/push receipts for
 * `commit-created`/`branch-pushed`, M6's check-polling for `check-failed`,
 * M4's dev-process exit event for `dev-process-exited`, project-open
 * navigation for `project-opened`, and a runtime scheduler tick for
 * `scheduled`. This module's only job is: given one event, which enabled
 * automations does it apply to.
 */
import type { AutomationCondition, AutomationConditionOperator, AutomationTriggerType } from './model';
import type { Automation } from './model';

export type AutomationEventContextValue = string | number | boolean | null;

export interface AutomationTriggerEvent {
  readonly type: AutomationTriggerType;
  readonly workspaceId: string;
  /** null for a workspace-level event (e.g. a scheduled tick with no project scope). */
  readonly projectId: string | null;
  readonly occurredAt: string;
  /** Flat key/value context the event carries — e.g. `{ branch: 'main', checkName: 'build', exitCode: 1 }`. Never raw terminal text or secrets (spec 29.2). */
  readonly context: Readonly<Record<string, AutomationEventContextValue>>;
}

/** True when `automation` is in scope for `event`: same trigger type, same workspace, and (automation is workspace-wide, or scoped to exactly this project). */
export function isInScope(automation: Pick<Automation, 'workspaceId' | 'projectId' | 'trigger'>, event: AutomationTriggerEvent): boolean {
  if (automation.trigger.type !== event.type) {
    return false;
  }
  if (automation.workspaceId !== event.workspaceId) {
    return false;
  }
  if (automation.projectId !== null && automation.projectId !== event.projectId) {
    return false;
  }
  return true;
}

function evaluateOperator(operator: AutomationConditionOperator, actual: AutomationEventContextValue, expected: string): boolean {
  const actualText = actual === null ? '' : String(actual);
  switch (operator) {
    case 'equals':
      return actualText === expected;
    case 'notEquals':
      return actualText !== expected;
    case 'contains':
      return actualText.includes(expected);
    case 'matches':
      try {
        return new RegExp(expected).test(actualText);
      } catch {
        // An invalid user-authored pattern must never crash the engine — it just never matches.
        return false;
      }
    default: {
      const exhaustive: never = operator;
      throw new Error(`Unknown automation condition operator: ${String(exhaustive)}`);
    }
  }
}

/** Every condition must pass (logical AND) — an automation with no conditions always passes this step. */
export function evaluateConditions(conditions: readonly AutomationCondition[], context: AutomationTriggerEvent['context']): boolean {
  return conditions.every((condition) => evaluateOperator(condition.operator, context[condition.field] ?? null, condition.value));
}

/** The full match: in scope, enabled, and every condition passes. */
export function matchesTrigger(automation: Automation, event: AutomationTriggerEvent): boolean {
  if (!automation.enabled) {
    return false;
  }
  if (!isInScope(automation, event)) {
    return false;
  }
  return evaluateConditions(automation.conditions, event.context);
}

/** Filters a list of automations down to the ones that should run for `event`, preserving order. */
export function matchingAutomations(automations: readonly Automation[], event: AutomationTriggerEvent): Automation[] {
  return automations.filter((automation) => matchesTrigger(automation, event));
}

/**
 * Filters a list of automations down to the ones in scope and enabled for
 * `event`, deliberately *without* evaluating conditions — the caller
 * (apps/desktop's `handleTriggerEvent`) passes every one of these into
 * `AutomationEngine.runAutomation`, which evaluates conditions itself and
 * writes a `skipped-conditions` receipt when they fail (spec 18.1's
 * "Execution history", 18.4's "each run produces a receipt"). Filtering by
 * conditions at this layer (the way `matchingAutomations` does) would make
 * that receipt state unreachable — an automation whose conditions never
 * pass would silently never leave a trace instead of a debuggable
 * "did not run because X" record.
 */
export function inScopeAutomations(automations: readonly Automation[], event: AutomationTriggerEvent): Automation[] {
  return automations.filter((automation) => automation.enabled && isInScope(automation, event));
}

/**
 * A `scheduled` automation is due when it has never run, or its last run
 * started at least `intervalMinutes` ago (spec 18.2's "Scheduled time while
 * app is running" — there is no persistent OS-level scheduler; a due check
 * only ever fires while the app process is alive, matching spec 18.5's
 * explicit exclusion of background/offline scheduling).
 */
export function isScheduledAutomationDue(
  automation: Pick<Automation, 'trigger' | 'enabled'>,
  now: Date,
  lastRunStartedAt: string | null,
): boolean {
  if (!automation.enabled || automation.trigger.type !== 'scheduled') {
    return false;
  }
  const intervalMinutes = automation.trigger.intervalMinutes ?? 60;
  if (lastRunStartedAt === null) {
    return true;
  }
  const elapsedMs = now.getTime() - new Date(lastRunStartedAt).getTime();
  return elapsedMs >= intervalMinutes * 60_000;
}
