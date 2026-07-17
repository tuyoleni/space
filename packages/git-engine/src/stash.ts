/**
 * Stash listing and apply/drop (Changes screen). A stash is a ref
 * operation, not a remote one, so it lives beside `tag.ts` rather than in
 * `remote.ts`. Everything runs the real `git stash` via the injected
 * `GitExecutor`; a repository with no stashes lists `[]` (spec 39: no
 * fabricated entries).
 */
import { REF_FIELD_SEPARATOR, stashApplyArgs, stashDropArgs, stashListArgs } from './commands';
import type { GitExecutor } from './clone';

/** One stash entry. `index` 0 is the most recent (`stash@{0}`); `branch` is the branch it was created on when parseable; `createdAt` is unix epoch milliseconds. */
export interface StashEntry {
  readonly index: number;
  readonly message: string;
  readonly branch: string | null;
  readonly createdAt: number;
}

/** Non-throwing outcome so a stash apply that leaves conflicts (exit 1) is reported as `completed: false` rather than an error. */
export interface StashApplyOutcome {
  readonly completed: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const STASH_SELECTOR = /^stash@\{(\d+)\}$/;
// Reflog subject shapes: "WIP on <branch>: <sha> <subject>" or "On <branch>: <message>".
const STASH_BRANCH = /^(?:WIP on|On) ([^:]+):/;

/**
 * Parses `git stash list --format=<STASH_FORMAT>` output (one entry per
 * line). The index is read from the `stash@{N}` selector so it stays
 * correct even if git ever reorders output; the branch is recovered from
 * the reflog subject and is `null` when it does not match the known shapes.
 */
export function parseStashList(stdout: string): StashEntry[] {
  const entries: StashEntry[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim().length === 0) {
      continue;
    }
    const [selector, dateUnix, ...messageParts] = line.split(REF_FIELD_SEPARATOR);
    const selectorMatch = STASH_SELECTOR.exec((selector ?? '').trim());
    if (!selectorMatch) {
      continue;
    }
    const message = messageParts.join(REF_FIELD_SEPARATOR);
    const branchMatch = STASH_BRANCH.exec(message);
    const seconds = Number((dateUnix ?? '').trim());
    entries.push({
      index: Number(selectorMatch[1]),
      message,
      branch: branchMatch ? (branchMatch[1] ?? '').trim() || null : null,
      createdAt: Number.isFinite(seconds) ? seconds * 1000 : 0,
    });
  }
  return entries;
}

/** Lists the repository's stashes, newest first. Returns `[]` when there are none. */
export async function listStashes(cwd: string, executor: GitExecutor): Promise<StashEntry[]> {
  const result = await executor(stashListArgs(), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git stash list failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return parseStashList(result.stdout);
}

/**
 * `git stash apply stash@{index}` — restores the entry without removing it.
 * A clean apply is `completed: true`; an apply that leaves merge conflicts
 * (exit 1) is `completed: false` with the details in `stderr` rather than a
 * thrown error, so the caller can surface the conflicted files. A fatal
 * error (e.g. an out-of-range index) still throws.
 */
export async function applyStash(cwd: string, index: number, executor: GitExecutor): Promise<StashApplyOutcome> {
  const result = await executor(stashApplyArgs(index), { cwd });
  if (result.exitCode === 128) {
    throw new Error(`git stash apply failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return { completed: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

/**
 * `git stash drop stash@{index}` — destructive removal of the entry. The
 * `confirmed` structural gate is enforced by the caller (handler layer);
 * this only runs the command and throws on failure.
 */
export async function dropStash(cwd: string, index: number, executor: GitExecutor): Promise<void> {
  const result = await executor(stashDropArgs(index), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git stash drop failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}
