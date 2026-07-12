/**
 * Project trust policy (spec section 10.3 PRJ-003, ADR-006). Pure decision
 * logic with no I/O: the storage layer persists `trust_state` on the
 * project row, and every privileged call site (install, lifecycle script,
 * project binary execution, shell-file sourcing, Electron content loading,
 * secret injection) must route through `assertTrusted` here before doing
 * anything — this is the structural gate, not a convention callers have to
 * remember.
 */

export type ProjectTrustState = 'untrusted' | 'trusted';

/**
 * The concrete list of operation kinds spec section 10.3 says Space MUST
 * NOT perform automatically while a project is untrusted.
 */
export type GatedOperationKind =
  | 'package-install'
  | 'lifecycle-script'
  | 'project-binary'
  | 'source-shell-file'
  | 'load-project-content'
  | 'inject-secrets';

/** The three trust choices spec section 10.3 requires the prompt to offer. */
export type TrustDecision = 'allow-once' | 'trust-this-project' | 'keep-untrusted';

export interface TrustCheckInput {
  readonly trustState: ProjectTrustState;
  readonly operation: GatedOperationKind;
  /**
   * True only when the user has just confirmed a one-time "allow once" for
   * *this specific invocation*. Never persisted — the caller must obtain a
   * fresh confirmation for every subsequent call while the project remains
   * untrusted.
   */
  readonly allowOnce?: boolean;
}

export interface TrustCheckResult {
  readonly permitted: boolean;
  readonly reason: string | null;
}

const GATED_OPERATION_EXPLANATION: Record<GatedOperationKind, string> = {
  'package-install': 'installing dependencies can execute arbitrary lifecycle scripts',
  'lifecycle-script': 'lifecycle scripts run arbitrary code with your user privileges',
  'project-binary': 'running a project-provided binary executes unreviewed code',
  'source-shell-file': "sourcing the project's shell files can silently alter your shell environment",
  'load-project-content': 'loading project-provided content in a privileged view can run arbitrary script',
  'inject-secrets': 'this project has not been reviewed and should not receive workspace secrets',
};

export function explainGatedOperation(operation: GatedOperationKind): string {
  return GATED_OPERATION_EXPLANATION[operation];
}

/**
 * Pure trust check: trusted projects pass every gated operation; untrusted
 * projects pass only when the caller supplies a fresh `allowOnce` for this
 * one invocation. Never throws — callers that need a hard stop should use
 * `assertTrusted`.
 */
export function checkTrust(input: TrustCheckInput): TrustCheckResult {
  if (input.trustState === 'trusted') {
    return { permitted: true, reason: null };
  }
  if (input.allowOnce === true) {
    return { permitted: true, reason: null };
  }
  return {
    permitted: false,
    reason: `Project is untrusted: ${explainGatedOperation(input.operation)}. Trust the project or allow once to proceed.`,
  };
}

export class TrustGateError extends Error {
  constructor(
    public readonly operation: GatedOperationKind,
    reason: string,
  ) {
    super(reason);
    this.name = 'TrustGateError';
  }
}

/** Throws `TrustGateError` when the operation is not permitted. */
export function assertTrusted(input: TrustCheckInput): void {
  const result = checkTrust(input);
  if (!result.permitted) {
    throw new TrustGateError(input.operation, result.reason ?? 'blocked by trust gate');
  }
}

/**
 * Applies a user's trust decision to the persisted state. `allow-once`
 * deliberately leaves the persisted state untouched — it authorizes a
 * single already-in-flight operation (via `allowOnce` on the next
 * `checkTrust`/`assertTrusted` call) without changing what future
 * operations require.
 */
export function applyTrustDecision(
  current: ProjectTrustState,
  decision: TrustDecision,
): ProjectTrustState {
  switch (decision) {
    case 'trust-this-project':
      return 'trusted';
    case 'allow-once':
    case 'keep-untrusted':
      return current;
    default: {
      const exhaustive: never = decision;
      throw new Error(`Unknown trust decision: ${String(exhaustive)}`);
    }
  }
}
