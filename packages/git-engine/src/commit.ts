/**
 * GIT-005: commit/checkpoint (spec 11.8). A commit operation must refresh
 * status immediately before execution, verify the intended index state,
 * run any configured pre-commit hooks in a visible process, display hook
 * failures accurately, create the real commit, verify the resulting SHA,
 * and (at the caller) record activity and a receipt.
 *
 * Hooks run *inside* the real `git commit` invocation itself — Git invokes
 * `.git/hooks/pre-commit` synchronously as part of the commit, so there is
 * no separate "run the hook" step to fake; this module's job is to capture
 * that combined stdout/stderr faithfully (`hookOutput`) so the caller can
 * show exactly what the hook printed, including on failure, rather than a
 * generic "commit failed" message.
 */
import { commitArgs, type CommitArgsOptions } from './commands';
import { identityConfigArgs, type GitIdentity } from './identity';
import type { RepositoryStatus, StatusEntry } from './status/types';
import type { GitExecutor } from './clone';

export class StaleIndexError extends Error {
  constructor(
    public readonly missing: readonly string[],
    public readonly unexpected: readonly string[],
  ) {
    super(
      `Staged files changed since the commit was prepared` +
        (missing.length > 0 ? ` (no longer staged: ${missing.join(', ')})` : '') +
        (unexpected.length > 0 ? ` (newly staged: ${unexpected.join(', ')})` : '') +
        '. Refresh and try again.',
    );
    this.name = 'StaleIndexError';
  }
}

export class CommitFailedError extends Error {
  constructor(
    message: string,
    public readonly hookOutput: string,
  ) {
    super(message);
    this.name = 'CommitFailedError';
  }
}

function stagedPath(entry: StatusEntry): string | null {
  if (entry.kind === 'ordinary' && entry.indexStatus !== '.') {
    return entry.path;
  }
  if (entry.kind === 'renamed-or-copied' && entry.indexStatus !== '.') {
    return entry.path;
  }
  return null;
}

/**
 * Compares a freshly refreshed status against the set of paths the commit
 * was prepared with. Throws `StaleIndexError` on any mismatch rather than
 * silently committing a different index state than the user reviewed
 * (spec 11.8: "verify the intended index state").
 */
export function verifyIntendedIndexState(
  currentStatus: RepositoryStatus,
  expectedStagedPaths: readonly string[],
): void {
  const actuallyStaged = new Set(currentStatus.entries.map(stagedPath).filter((p): p is string => p !== null));
  const expected = new Set(expectedStagedPaths);
  const missing = [...expected].filter((p) => !actuallyStaged.has(p));
  const unexpected = [...actuallyStaged].filter((p) => !expected.has(p));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new StaleIndexError(missing, unexpected);
  }
}

export interface CommitOptions extends CommitArgsOptions {
  readonly identity: GitIdentity;
  readonly message: string;
}

export interface CommitOutcome {
  readonly sha: string;
  readonly hookOutput: string;
}

/**
 * Runs the real `git commit`, with identity injected via `-c` (never a
 * config-file write) and the message delivered over stdin (never `-m`,
 * spec 11.7/21.3). Verifies the resulting SHA with `rev-parse HEAD` rather
 * than trusting exit code 0 alone (spec 39).
 */
export async function runCommit(cwd: string, options: CommitOptions, executor: GitExecutor): Promise<CommitOutcome> {
  const args = [...identityConfigArgs(options.identity), ...commitArgs(options)];
  const result = await executor(args, { cwd, input: options.message });
  const hookOutput = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    throw new CommitFailedError(
      `git commit failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`,
      hookOutput,
    );
  }

  const shaResult = await executor(['rev-parse', 'HEAD'], { cwd });
  if (shaResult.exitCode !== 0 || shaResult.stdout.trim().length === 0) {
    throw new Error('git commit appeared to succeed but the resulting SHA could not be verified with rev-parse HEAD');
  }
  return { sha: shaResult.stdout.trim(), hookOutput };
}
