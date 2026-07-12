/**
 * GIT-004: staging (spec 11.7). File-level stage/unstage use `git add`/
 * `git restore --staged`. Hunk- and line-level stage/unstage/discard are
 * mechanically the same operation — applying a patch to the index or
 * worktree — the difference is only how much of the full diff the caller
 * includes in the patch text (an intent-layer/renderer concern, spec
 * section 13). This module only guarantees the mechanical half: patches
 * always travel over stdin, never a shell-escaped string (spec 11.7,
 * 21.3), and every entry point requires the caller to have already built
 * the patch text from a real `git diff` (spec 39: never fabricate a diff).
 */
import { addPathsArgs, applyPatchArgs, checkoutPathsArgs, cleanUntrackedArgs, resetPathsArgs } from './commands';
import type { GitExecutor } from './clone';

async function run(executor: GitExecutor, args: string[], cwd: string, input?: string): Promise<void> {
  const result = await executor(args, input !== undefined ? { cwd, input } : { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}

export async function stageFiles(cwd: string, paths: readonly string[], executor: GitExecutor): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await run(executor, addPathsArgs(paths), cwd);
}

export async function unstageFiles(cwd: string, paths: readonly string[], executor: GitExecutor): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await run(executor, resetPathsArgs(paths), cwd);
}

/**
 * Stages a hunk/line-level selection: `patchText` must be a valid unified
 * diff (produced from a real `git diff`, scoped to the selected hunk or
 * lines) and is applied to the index only, never the worktree.
 */
export async function stagePatch(cwd: string, patchText: string, executor: GitExecutor): Promise<void> {
  await run(executor, applyPatchArgs({ cached: true }), cwd, patchText);
}

/** Reverses a hunk/line-level selection out of the index (unstage), worktree untouched. */
export async function unstagePatch(cwd: string, patchText: string, executor: GitExecutor): Promise<void> {
  await run(executor, applyPatchArgs({ cached: true, reverse: true }), cwd, patchText);
}

/**
 * Discards a hunk/line-level selection from the worktree — destructive
 * and irreversible, so the caller (UI) must have already obtained explicit
 * confirmation (spec 11.7: "with confirmation and recovery guidance")
 * before calling this.
 */
export async function discardPatch(cwd: string, patchText: string, executor: GitExecutor): Promise<void> {
  await run(executor, applyPatchArgs({ reverse: true }), cwd, patchText);
}

/** Discards all unstaged changes to tracked files at `paths` — destructive; caller must confirm first. */
export async function discardTrackedFiles(cwd: string, paths: readonly string[], executor: GitExecutor): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await run(executor, checkoutPathsArgs(paths), cwd);
}

/** Removes untracked files at `paths` — destructive; caller must confirm first. */
export async function discardUntrackedFiles(cwd: string, paths: readonly string[], executor: GitExecutor): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await run(executor, cleanUntrackedArgs(paths), cwd);
}
