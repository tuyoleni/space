/**
 * Structural confirmation gate for automation-dispatched actions (spec
 * 18.4 safety rules). This is deliberately *not* the same shape as
 * `agent-confirmation.ts`'s `assertAgentActionConfirmed`: an agent action
 * is dispatched with a human sitting in front of the UI who can tick
 * "confirmed" at the moment of the call, but an automation runs
 * unattended — there is no human present to confirm a `destructive`
 * action at execution time, so this gate has no `confirmed` field at all.
 * That is the structural enforcement of "destructive operations cannot be
 * fully automated in V1" (spec 18.4): the type this function accepts does
 * not have a shape that could ever satisfy a destructive action, not even
 * in principle, so no call site can compile a path around it. Reinforced
 * a second time at the type level: `AutomationActionType` in
 * `@space/automation` only contains the exact seven V1 actions from spec
 * 18.3, none of which is destructive by nature (no force-push, branch
 * delete, merge, or release-publish action exists in that union) — this
 * function's `destructive` branch is defence in depth for a state that
 * should be unreachable through the schema, not the only thing preventing
 * it.
 *
 * `remote`-risk automation actions (spec 18.3's "trigger a selected GitHub
 * workflow after explicit permission") still require a live, non-revoked
 * standing permission scoped to the exact action — reusing
 * `AgentStandingPermission`/`agent_standing_permissions` (spec 18.4: "reuse
 * M7's standing-permission storage if it fits" — it does: both are a
 * narrow, revocable grant keyed by workspace/project/action type, and nothing
 * about that shape is agent-specific).
 */
import type { AgentStandingPermission } from './agent-confirmation';

/** Mirrors `AgentActionRisk`/`RiskLevel` (spec 19.2's four permission levels, reused unchanged for automation actions per spec 18.1's "permission requirements"). */
export type AutomationActionRisk = 'observe' | 'local-reversible' | 'remote' | 'destructive';

export interface AutomationActionConfirmationInput {
  readonly risk: AutomationActionRisk;
  /** A standing permission scoped to this exact automation action; ignored (and never sufficient) for `destructive` risk. */
  readonly standingPermission?: AgentStandingPermission | null;
}

export class AutomationActionNotPermittedError extends Error {
  constructor(public readonly risk: AutomationActionRisk) {
    super(
      risk === 'destructive'
        ? 'Automation action rejected: destructive operations cannot be fully automated — a human must perform this action directly.'
        : `Automation action rejected: ${risk} actions require a live, non-revoked standing permission scoped to this exact action, and none was found.`,
    );
    this.name = 'AutomationActionNotPermittedError';
  }
}

/**
 * `observe` and `local-reversible` actions always run (an automation still
 * separately needs project trust for anything that touches the
 * filesystem/process — a different gate, not this one). `remote` actions
 * run only with a live standing permission. `destructive` actions never
 * run, unconditionally, regardless of any input field — there is no
 * escape hatch, by design (spec 18.4, spec 39: "destructive operations
 * cannot be fully automated in V1").
 */
export function checkAutomationActionConfirmation(input: AutomationActionConfirmationInput): { permitted: boolean } {
  if (input.risk === 'observe' || input.risk === 'local-reversible') {
    return { permitted: true };
  }
  if (input.risk === 'destructive') {
    return { permitted: false };
  }
  const grant = input.standingPermission;
  if (grant && !grant.revoked) {
    return { permitted: true };
  }
  return { permitted: false };
}

/** Throws `AutomationActionNotPermittedError` when the action is not permitted. */
export function assertAutomationActionConfirmed(input: AutomationActionConfirmationInput): void {
  if (!checkAutomationActionConfirmation(input).permitted) {
    throw new AutomationActionNotPermittedError(input.risk);
  }
}
