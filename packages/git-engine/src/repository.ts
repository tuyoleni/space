/**
 * Repository root/state orchestration (spec 11.3.1, 11.4). Combines the
 * structured `rev-parse`/`status` commands and the in-progress operation
 * detector into the single read every status refresh needs, so callers
 * (the operation queue's coalesced refresh, the watcher's hint handler)
 * have one entry point rather than re-assembling it themselves.
 */
import path from 'node:path';
import { gitDirArgs, isInsideWorkTreeArgs, repositoryRootArgs, statusArgs } from './commands';
import { detectRepositoryOperationState, type GitDirFsPort, type RepositoryOperationState } from './repository-state';
import { parseStatusOutput } from './status/parser';
import type { RepositoryStatus } from './status/types';
import type { GitExecutor } from './clone';

export async function resolveRepositoryRoot(targetDir: string, executor: GitExecutor): Promise<string | null> {
  const result = await executor(repositoryRootArgs(), { cwd: targetDir });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function isInsideWorkTree(targetDir: string, executor: GitExecutor): Promise<boolean> {
  const result = await executor(isInsideWorkTreeArgs(), { cwd: targetDir });
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}

/** Resolves the git directory to an absolute path (`rev-parse --git-dir` may return a relative path). */
export async function resolveGitDir(targetDir: string, executor: GitExecutor): Promise<string | null> {
  const result = await executor(gitDirArgs(), { cwd: targetDir });
  if (result.exitCode !== 0) {
    return null;
  }
  const raw = result.stdout.trim();
  return path.isAbsolute(raw) ? raw : path.resolve(targetDir, raw);
}

export interface FullRepositoryStatus {
  readonly gitDir: string;
  readonly status: RepositoryStatus;
  readonly operationState: RepositoryOperationState;
}

/**
 * The authoritative status read (spec 11.12: "git status remains
 * authoritative" — a watcher event is only ever a hint to call this).
 */
export async function getFullRepositoryStatus(
  cwd: string,
  executor: GitExecutor,
  gitDirFs: GitDirFsPort,
): Promise<FullRepositoryStatus> {
  const gitDir = await resolveGitDir(cwd, executor);
  if (!gitDir) {
    throw new Error(`"${cwd}" is not inside a Git working tree`);
  }
  const [statusResult, operationState] = await Promise.all([
    // Per-file untracked listing: Git otherwise collapses a wholly-untracked
    // directory into a single entry, so a burst that created 32 files under
    // src/ reported as one change everywhere this status is counted — the
    // badge, the dashboard tiles, and the file list all shrank exactly when
    // the change set grew large enough to matter. Ignored paths are still
    // excluded, so this does not walk node_modules.
    executor(statusArgs({ untrackedFiles: 'all' }), { cwd }),
    detectRepositoryOperationState(gitDir, gitDirFs),
  ]);
  if (statusResult.exitCode !== 0) {
    throw new Error(`git status failed: ${statusResult.stderr.trim() || `exit code ${statusResult.exitCode}`}`);
  }
  return { gitDir, status: parseStatusOutput(statusResult.stdout), operationState };
}
