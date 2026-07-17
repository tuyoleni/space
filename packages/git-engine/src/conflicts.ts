/**
 * GIT-008: conflicts (spec 11.11). Conflict state is derived explicitly
 * from the unmerged entries in a real `git status` plus the in-progress
 * operation state (spec 11.4/11.12) — Space never implies a merge or
 * rebase is complete until Git itself confirms it, so every continue
 * re-checks operation state afterward rather than trusting the command's
 * exit code alone (spec 39).
 */
import { assertDestructiveGitActionConfirmed } from '@space/domain';
import {
  addPathsArgs,
  checkoutSideArgs,
  cherryPickAbortArgs,
  cherryPickContinueArgs,
  mergeAbortArgs,
  mergeContinueArgs,
  mergeStartArgs,
  rebaseAbortArgs,
  rebaseContinueArgs,
  revertAbortArgs,
  revertContinueArgs,
} from './commands';
import { detectRepositoryOperationState, type GitDirFsPort, type RepositoryOperationState } from './repository-state';
import type { RepositoryStatus } from './status/types';
import type { GitExecutor } from './clone';

export interface ConflictState {
  readonly inConflict: boolean;
  readonly operation: RepositoryOperationState;
  readonly conflictedFiles: readonly string[];
}

export function deriveConflictState(
  status: RepositoryStatus,
  operationState: RepositoryOperationState,
): ConflictState {
  const conflictedFiles = status.entries.filter((entry) => entry.kind === 'unmerged').map((entry) => entry.path);
  return { inConflict: conflictedFiles.length > 0, operation: operationState, conflictedFiles };
}

type ContinuableOperation = Extract<RepositoryOperationState['kind'], 'merge' | 'rebase' | 'cherry-pick' | 'revert'>;

const CONTINUE_ARGS: Record<ContinuableOperation, () => string[]> = {
  merge: mergeContinueArgs,
  rebase: rebaseContinueArgs,
  'cherry-pick': cherryPickContinueArgs,
  revert: revertContinueArgs,
};

const ABORT_ARGS: Record<ContinuableOperation, () => string[]> = {
  merge: mergeAbortArgs,
  rebase: rebaseAbortArgs,
  'cherry-pick': cherryPickAbortArgs,
  revert: revertAbortArgs,
};

function isContinuable(kind: RepositoryOperationState['kind']): kind is ContinuableOperation {
  return kind === 'merge' || kind === 'rebase' || kind === 'cherry-pick' || kind === 'revert';
}

export interface OperationOutcome {
  /** True only once Git's own state files confirm no operation remains in progress. */
  readonly completed: boolean;
  readonly remaining: RepositoryOperationState;
  readonly stdout: string;
  readonly stderr: string;
}

async function runAndVerify(
  cwd: string,
  gitDir: string,
  args: string[],
  executor: GitExecutor,
  gitDirFs: GitDirFsPort,
): Promise<OperationOutcome> {
  const result = await executor(args, { cwd });
  // Re-check real repository state regardless of exit code: a continue can
  // exit non-zero because more conflicts remain, which is not a crash —
  // and it can exit zero while a multi-step sequence (cherry-pick/revert
  // series) still has more commits queued.
  const remaining = await detectRepositoryOperationState(gitDir, gitDirFs);
  return { completed: remaining.kind === 'none', remaining, stdout: result.stdout, stderr: result.stderr };
}

/** Continues the in-progress operation (spec 11.11: "safe continue/abort commands"). */
export async function continueOperation(
  cwd: string,
  gitDir: string,
  operation: RepositoryOperationState,
  executor: GitExecutor,
  gitDirFs: GitDirFsPort,
): Promise<OperationOutcome> {
  if (!isContinuable(operation.kind)) {
    throw new Error(`No continuable Git operation is in progress (state: "${operation.kind}")`);
  }
  return runAndVerify(cwd, gitDir, CONTINUE_ARGS[operation.kind](), executor, gitDirFs);
}

export async function abortOperation(
  cwd: string,
  gitDir: string,
  operation: RepositoryOperationState,
  executor: GitExecutor,
  gitDirFs: GitDirFsPort,
): Promise<OperationOutcome> {
  if (!isContinuable(operation.kind)) {
    throw new Error(`No abortable Git operation is in progress (state: "${operation.kind}")`);
  }
  return runAndVerify(cwd, gitDir, ABORT_ARGS[operation.kind](), executor, gitDirFs);
}

export interface MergeBranchOptions {
  readonly noFf?: boolean;
  /** Structural confirmation — see @space/domain's assertDestructiveGitActionConfirmed. */
  readonly confirmed: boolean;
}

/**
 * Starts a merge of `branch` into the current branch. Unlike
 * `continueOperation`/`abortOperation` (resuming an operation Git already
 * confirmed is in progress, where a non-zero exit only ever means
 * "conflicts remain"), a *fresh* merge attempt can fail for reasons that
 * never start an operation at all — an unknown branch name, a dirty
 * working tree, an unrelated-histories error — and those must surface as
 * real errors rather than a silent `completed: true`, since `remaining.
 * kind` would read `none` in both the "merge succeeded" and the "merge
 * never started" cases.
 */
export async function mergeBranch(
  cwd: string,
  gitDir: string,
  branch: string,
  options: MergeBranchOptions,
  executor: GitExecutor,
  gitDirFs: GitDirFsPort,
): Promise<OperationOutcome> {
  assertDestructiveGitActionConfirmed({ action: 'merge-branch', confirmed: options.confirmed });
  const result = await executor(mergeStartArgs(branch, options.noFf ? { noFf: true } : {}), { cwd });
  const remaining = await detectRepositoryOperationState(gitDir, gitDirFs);
  if (result.exitCode !== 0 && remaining.kind === 'none') {
    throw new Error(`git merge failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return { completed: remaining.kind === 'none', remaining, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Resolves one conflicted file by taking a whole side (spec 11.11's
 * per-file resolution): `git checkout --ours|--theirs -- <path>` picks the
 * chosen version into the worktree, then `git add -- <path>` stages it so
 * the file drops out of the unmerged set. Both steps run for real; a
 * non-zero checkout (e.g. the path is not conflicted) throws rather than
 * silently staging a stale file (spec 39).
 */
export async function resolveConflict(
  cwd: string,
  path: string,
  side: 'ours' | 'theirs',
  executor: GitExecutor,
): Promise<void> {
  const checkout = await executor(checkoutSideArgs(side, path), { cwd });
  if (checkout.exitCode !== 0) {
    throw new Error(
      `git checkout --${side} failed: ${checkout.stderr.trim() || checkout.stdout.trim() || `exit code ${checkout.exitCode}`}`,
    );
  }
  const stage = await executor(addPathsArgs([path]), { cwd });
  if (stage.exitCode !== 0) {
    throw new Error(`git add failed: ${stage.stderr.trim() || stage.stdout.trim() || `exit code ${stage.exitCode}`}`);
  }
}
