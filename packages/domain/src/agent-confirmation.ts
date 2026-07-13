/**
 * Structural confirmation gate for agent-proposed actions (spec 19.2
 * permission levels, 19.2.4: "destructive actions require confirmation
 * every time. Remote standing permissions must be narrow and revocable";
 * spec 25.3.6: "human confirmation for high-impact actions"). Mirrors
 * `assertDestructiveGitActionConfirmed`/`assertHighImpactGithubActionConfirmed`
 * exactly: every call site that executes an `AgentAction` must pass
 * through `assertAgentActionConfirmed` first, so confirmation is a
 * structural gate the code cannot compile around — not a UI convention a
 * caller (or an untrusted model) could skip.
 *
 * `AgentActionRisk` intentionally repeats `RiskLevel`'s literal union
 * (`@space/workspace-runner`) rather than importing it, the same way
 * `@space/storage`'s `OperationRisk` does — this package has no I/O
 * dependencies and stays that way; the two types are kept in lockstep by
 * convention and by every call site's own type-checking against the real
 * `RiskLevel`.
 */

/** Mirrors `RiskLevel` in `@space/workspace-runner` (spec 19.2's four permission levels). */
export type AgentActionRisk = 'observe' | 'local-reversible' | 'remote' | 'destructive';

/**
 * A narrow, revocable standing permission for one specific agent action
 * type in one specific scope (spec 19.2.3/19.2.4: "remote standing
 * permissions must be narrow and revocable"). Never applies to destructive
 * actions — see `assertAgentActionConfirmed`.
 */
export interface AgentStandingPermission {
  readonly actionType: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly grantedAt: string;
  readonly revoked: boolean;
}

export interface AgentActionConfirmationInput {
  readonly risk: AgentActionRisk;
  readonly confirmed: boolean;
  /** A standing permission scoped to this exact action; ignored for `destructive` risk. */
  readonly standingPermission?: AgentStandingPermission | null;
}

export class AgentActionNotConfirmedError extends Error {
  constructor(public readonly risk: AgentActionRisk) {
    super(
      risk === 'destructive'
        ? 'Destructive agent action was not confirmed: destructive actions require confirmation every time.'
        : `Remote agent action was not confirmed and no valid standing permission covers it: ${risk} actions require confirmation or a narrow, revocable standing permission.`,
    );
    this.name = 'AgentActionNotConfirmedError';
  }
}

/**
 * `observe` and `local-reversible` actions are always permitted here
 * (local-reversible actions such as `file.modify`/`project.runScript`
 * still separately require project trust — see `assertTrusted` in
 * `trust.ts`, which is a different gate this function does not replace).
 * `remote` actions require either explicit confirmation or a live,
 * non-revoked standing permission scoped to this exact action type/
 * workspace/project. `destructive` actions require explicit confirmation
 * every single time — no standing permission ever satisfies it, matching
 * spec 19.2.4 and spec 39's "never silently force push, hard reset,
 * delete branches, publish releases, or deploy production".
 */
export function checkAgentActionConfirmation(input: AgentActionConfirmationInput): { permitted: boolean } {
  if (input.risk === 'observe' || input.risk === 'local-reversible') {
    return { permitted: true };
  }
  if (input.confirmed) {
    return { permitted: true };
  }
  if (input.risk === 'remote') {
    const grant = input.standingPermission;
    if (grant && !grant.revoked) {
      return { permitted: true };
    }
  }
  return { permitted: false };
}

/** Throws `AgentActionNotConfirmedError` when the action is not permitted. */
export function assertAgentActionConfirmed(input: AgentActionConfirmationInput): void {
  if (!checkAgentActionConfirmation(input).permitted) {
    throw new AgentActionNotConfirmedError(input.risk);
  }
}

/** Marks a standing permission revoked — pure state transition; persistence is the caller's concern. */
export function revokeStandingPermission(grant: AgentStandingPermission): AgentStandingPermission {
  return { ...grant, revoked: true };
}
