/**
 * Linked working trees (Changes screen). Parses the stable
 * `git worktree list --porcelain` format — blank-line-separated records of
 * `worktree <path>` / `HEAD <sha>` / `branch <ref>` (or `detached`) —
 * rather than the human-formatted output. Runs real `git`; a repository
 * with a single working tree still lists that one entry.
 */
import { worktreeListArgs } from './commands';
import type { GitExecutor } from './clone';

/** One linked working tree. `isMain` marks the primary worktree (the first record); `isCurrent` marks the one whose path is `currentRoot`. */
export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly headSha: string;
  readonly isMain: boolean;
  readonly isCurrent: boolean;
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Parses `git worktree list --porcelain` output. `currentRoot` is the
 * repository root the request came from; the worktree whose path matches it
 * is flagged `isCurrent`. The first record is always the main worktree.
 */
export function parseWorktreePorcelain(stdout: string, currentRoot: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const target = normalizePath(currentRoot);
  let path: string | null = null;
  let headSha = '';
  let branch: string | null = null;

  const flush = (): void => {
    if (path === null) {
      return;
    }
    entries.push({
      path,
      branch,
      headSha,
      isMain: entries.length === 0,
      isCurrent: normalizePath(path) === target,
    });
    path = null;
    headSha = '';
    branch = null;
  };

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      headSha = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (line === 'detached') {
      branch = null;
    }
    // `bare`, `locked`, `prunable` carry no field this UI needs.
  }
  flush();
  return entries;
}

/** Lists the repository's linked working trees. `currentRoot` should be the repo toplevel so exactly one entry is flagged `isCurrent`. */
export async function listWorktrees(cwd: string, currentRoot: string, executor: GitExecutor): Promise<WorktreeEntry[]> {
  const result = await executor(worktreeListArgs(), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git worktree list failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return parseWorktreePorcelain(result.stdout, currentRoot);
}
