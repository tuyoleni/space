/**
 * GIT-006: branch operations (spec 11.9). Create-from-commit, switch,
 * rename, delete-with-merged-check, publish/upstream, and compare.
 * Destructive deletion routes through `assertDestructiveGitActionConfirmed`
 * (@space/domain) — the same structural gate M4 established for project
 * trust — so a caller cannot delete a branch without having passed an
 * explicit confirmation flag through, regardless of what the UI does.
 */
import { assertDestructiveGitActionConfirmed } from '@space/domain';
import {
  branchIsMergedArgs,
  createBranchArgs,
  deleteBranchArgs,
  diffNumstatArgs,
  renameBranchArgs,
  setUpstreamArgs,
  switchBranchArgs,
} from './commands';
import { parseDiffNumstatOutput } from './diff/parser';
import type { DiffNumstatEntry } from './diff/types';
import type { GitExecutor } from './clone';

async function run(executor: GitExecutor, args: string[], cwd: string): Promise<void> {
  const result = await executor(args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}

export async function createBranch(
  cwd: string,
  name: string,
  fromCommit: string | undefined,
  executor: GitExecutor,
): Promise<void> {
  await run(executor, createBranchArgs(name, fromCommit), cwd);
}

export async function switchBranch(cwd: string, name: string, executor: GitExecutor): Promise<void> {
  await run(executor, switchBranchArgs(name), cwd);
}

export async function renameBranch(cwd: string, oldName: string, newName: string, executor: GitExecutor): Promise<void> {
  await run(executor, renameBranchArgs(oldName, newName), cwd);
}

/** True when `branchName`'s history is fully contained in `targetRef` (safe to delete without losing commits). */
export async function isBranchMerged(
  cwd: string,
  branchName: string,
  targetRef: string,
  executor: GitExecutor,
): Promise<boolean> {
  const result = await executor(branchIsMergedArgs(branchName, targetRef), { cwd });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export interface DeleteBranchOptions {
  /** Use `-D` instead of `-d`; required whenever the branch is not merged. */
  readonly force: boolean;
  /** Structural confirmation — see @space/domain's assertDestructiveGitActionConfirmed. */
  readonly confirmed: boolean;
}

export async function deleteBranch(
  cwd: string,
  branchName: string,
  options: DeleteBranchOptions,
  executor: GitExecutor,
): Promise<void> {
  assertDestructiveGitActionConfirmed({ action: 'delete-branch', confirmed: options.confirmed });
  await run(executor, deleteBranchArgs(branchName, options.force), cwd);
}

export async function setUpstream(cwd: string, remoteName: string, branch: string, executor: GitExecutor): Promise<void> {
  await run(executor, setUpstreamArgs(remoteName, branch), cwd);
}

export interface BranchComparison {
  readonly files: readonly DiffNumstatEntry[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
}

/** Compares two refs (e.g. a feature branch against its base) via numstat — never by parsing `git log --graph`. */
export async function compareBranches(
  cwd: string,
  baseRef: string,
  headRef: string,
  executor: GitExecutor,
): Promise<BranchComparison> {
  const result = await executor([...diffNumstatArgs(), `${baseRef}...${headRef}`], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  }
  const files = parseDiffNumstatOutput(result.stdout);
  return {
    files,
    totalAdded: files.reduce((sum, f) => sum + (f.added ?? 0), 0),
    totalRemoved: files.reduce((sum, f) => sum + (f.removed ?? 0), 0),
  };
}
