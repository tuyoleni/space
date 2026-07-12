/**
 * Structural confirmation gate for high-impact remote GitHub actions (spec
 * 14.6 GH-004: "merge only with explicit confirmation and policy checks";
 * 14.10 GH-008: "publishing is a high-impact remote action and requires
 * confirmation"). Mirrors `assertDestructiveGitActionConfirmed` exactly:
 * every call site that merges a PR, publishes a release, or triggers a
 * remote-mutating release/actions workflow must pass through
 * `assertHighImpactGithubActionConfirmed` first, so the gate is structural
 * — the code cannot compile around it — rather than a UI dialog a caller
 * could forget to wire up (spec 39: never publish releases without review).
 */

export type HighImpactGithubAction =
  | 'merge-pull-request'
  | 'publish-release'
  | 'trigger-workflow-dispatch'
  | 'trigger-release-workflow';

export interface HighImpactGithubActionInput {
  readonly action: HighImpactGithubAction;
  readonly confirmed: boolean;
}

const HIGH_IMPACT_ACTION_EXPLANATION: Record<HighImpactGithubAction, string> = {
  'merge-pull-request': 'merging a pull request changes the base branch\'s history for everyone with access to the repository',
  'publish-release': 'publishing a release is visible to every user of the repository and can trigger downstream automation',
  'trigger-workflow-dispatch': 'triggering a workflow can run arbitrary CI automation against a real branch or tag',
  'trigger-release-workflow': 'triggering a release workflow can publish artifacts or deploy on the strength of this one action',
};

export class HighImpactGithubActionNotConfirmedError extends Error {
  constructor(public readonly action: HighImpactGithubAction) {
    super(`GitHub action "${action}" was not confirmed: ${HIGH_IMPACT_ACTION_EXPLANATION[action]}.`);
    this.name = 'HighImpactGithubActionNotConfirmedError';
  }
}

export function assertHighImpactGithubActionConfirmed(input: HighImpactGithubActionInput): void {
  if (!input.confirmed) {
    throw new HighImpactGithubActionNotConfirmedError(input.action);
  }
}
