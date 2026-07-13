/**
 * The apply-safety gate (spec 31.3: "The UI must not interrupt running
 * installations, Git mutations, or unrecoverable operations. Database
 * migrations are considered before applying an update."). Pure decision
 * function — the caller (apps/desktop) supplies live counts from
 * whatever it already tracks (running operations, in-flight PTY/dev
 * processes, pending migrations), and this decides whether "apply the
 * downloaded update now" is safe, or must wait.
 */
export interface ApplyGateInput {
  /** Any currently-running bootstrap/tool installation (spec 8/9) — never interrupted mid-install. */
  readonly hasRunningInstallation: boolean;
  /** Any currently-running Git mutation (commit/push/merge/rebase/...) — never interrupted mid-mutation. */
  readonly hasInFlightGitMutation: boolean;
  /** Any operation whose receipt is not yet in a terminal state and whose partial effect cannot be safely abandoned (spec 33's "unrecoverable operations"). */
  readonly hasUnrecoverableOperation: boolean;
  /**
   * Migrations this running binary already knows about but has not yet
   * applied to the local database (e.g. a previous update replaced the
   * app files but the app was killed before its first post-update
   * migration run). A nonzero count means the local schema is in a
   * transitional state — applying *another* update on top of that before
   * the app has ever reconciled its own pending migrations would compound
   * an already-inconsistent state, so this blocks until that count is
   * zero, independent of the other three checks.
   */
  readonly pendingLocalMigrationCount: number;
}

export interface ApplyGateDecision {
  readonly canApplyNow: boolean;
  /** Every reason blocking the apply right now — empty when canApplyNow is true. A caller surfaces these verbatim rather than picking just one, since more than one can be true at once. */
  readonly blockingReasons: readonly string[];
}

/** Structural, not advisory: a caller that ignores `canApplyNow` and applies anyway is not following this gate — same "the function itself is the enforcement" pattern as `assertAutomationActionConfirmed`. */
export function evaluateApplyGate(input: ApplyGateInput): ApplyGateDecision {
  const blockingReasons: string[] = [];
  if (input.hasRunningInstallation) {
    blockingReasons.push('a tool installation is currently running');
  }
  if (input.hasInFlightGitMutation) {
    blockingReasons.push('a Git mutation is currently in flight');
  }
  if (input.hasUnrecoverableOperation) {
    blockingReasons.push('an operation with unrecoverable partial state is still running');
  }
  if (input.pendingLocalMigrationCount > 0) {
    blockingReasons.push(`${input.pendingLocalMigrationCount} local database migration(s) are still pending from a previous update`);
  }
  return { canApplyNow: blockingReasons.length === 0, blockingReasons };
}
