/**
 * Structural confirmation gate for destructive/force Git actions (spec
 * 11.9 GIT-006, 11.10 GIT-007: "destructive branch deletion and force
 * operations require explicit confirmation"; spec 39: never silently force
 * push, hard reset, or delete branches). Mirrors `assertTrusted` in
 * trust.ts exactly: every call site that performs a destructive Git action
 * must pass through `assertDestructiveGitActionConfirmed` first — this is
 * a structural gate the code cannot compile around, not a UI convention a
 * caller could forget to wire up.
 */

export type DestructiveGitAction =
  | 'delete-branch'
  | 'discard-changes'
  | 'hard-reset'
  | 'force-push-with-lease'
  | 'force-push-raw'
  | 'merge-branch';

export interface DestructiveGitActionInput {
  readonly action: DestructiveGitAction;
  readonly confirmed: boolean;
}

const DESTRUCTIVE_ACTION_EXPLANATION: Record<DestructiveGitAction, string> = {
  'delete-branch': 'deleting a branch can permanently lose commits that are not reachable from anywhere else',
  'discard-changes': 'discarding changes permanently destroys uncommitted work',
  'hard-reset': 'a hard reset permanently discards commits and uncommitted changes',
  'force-push-with-lease': 'a force push rewrites remote history; --force-with-lease still requires confirmation',
  'force-push-raw':
    'a raw --force push rewrites remote history without checking for other people\'s work and can destroy it',
  'merge-branch': 'merging can leave the repository in a conflicted state that blocks other work until resolved',
};

export class DestructiveGitActionNotConfirmedError extends Error {
  constructor(public readonly action: DestructiveGitAction) {
    super(`Destructive Git action "${action}" was not confirmed: ${DESTRUCTIVE_ACTION_EXPLANATION[action]}.`);
    this.name = 'DestructiveGitActionNotConfirmedError';
  }
}

/**
 * Raw `--force` push additionally requires a policy gate on top of
 * confirmation (spec 11.10: "behind an advanced confirmation and policy
 * gate, not just a warning dialog"). `policyAllowsRawForce` defaults to
 * false so raw force is opt-in per call site, never accidentally enabled.
 */
export function assertDestructiveGitActionConfirmed(
  input: DestructiveGitActionInput,
  policyAllowsRawForce = false,
): void {
  if (!input.confirmed) {
    throw new DestructiveGitActionNotConfirmedError(input.action);
  }
  if (input.action === 'force-push-raw' && !policyAllowsRawForce) {
    throw new DestructiveGitActionNotConfirmedError(input.action);
  }
}
