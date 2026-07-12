/**
 * Real `git clone` support (PRJ-001/PRJ-004 clone flow, spec section 11).
 * The system `git` executable is the single source of truth (spec 11.1) —
 * no libgit2. Process spawning is injected (`GitExecutor`, spec section 33)
 * so this module never shells out in a unit test; the hermetic integration
 * test clones a real local fixture repository instead of hitting the
 * network (spec section 39: no hard-coded fixtures standing in for a real
 * operation in production code — the fixture here lives only in the test).
 *
 * Command construction never concatenates a shell string (spec 21.3):
 * arguments are always an array, and `--` separates flags from
 * caller-supplied values so a remote URL or destination path that happens
 * to start with `-` can never be interpreted as a git flag.
 */

export interface GitCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>`. Must never be invoked with `shell: true` (spec 25.3.2). */
export type GitExecutor = (
  args: readonly string[],
  options?: { readonly cwd?: string; readonly timeoutMs?: number },
) => Promise<GitCommandResult>;

export interface CloneRepositoryInput {
  readonly remoteUrl: string;
  readonly destination: string;
  readonly branch?: string;
  readonly timeoutMs?: number;
}

export interface CloneRepositoryResult {
  readonly destination: string;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Rejects values that would be interpreted as a git flag rather than a
 * value (defence in depth alongside the `--` separator in `cloneArgs`) and
 * values that are obviously not a usable clone source.
 */
export function validateCloneSource(remoteUrl: string): void {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('Clone source must not be empty');
  }
  if (trimmed.startsWith('-')) {
    throw new Error(`Clone source "${remoteUrl}" must not start with "-"`);
  }
}

export function validateCloneDestination(destination: string): void {
  const trimmed = destination.trim();
  if (trimmed.length === 0) {
    throw new Error('Clone destination must not be empty');
  }
  if (trimmed.startsWith('-')) {
    throw new Error(`Clone destination "${destination}" must not start with "-"`);
  }
}

export function cloneArgs(input: CloneRepositoryInput): string[] {
  const args = ['clone'];
  if (input.branch !== undefined) {
    if (input.branch.trim().length === 0 || input.branch.startsWith('-')) {
      throw new Error(`Branch name "${input.branch}" is not valid`);
    }
    args.push('--branch', input.branch);
  }
  args.push('--', input.remoteUrl, input.destination);
  return args;
}

/**
 * Clones `remoteUrl` into `destination` with the real `git` executable via
 * the injected `GitExecutor`. Throws on a non-zero exit so callers get a
 * clear failure rather than a silently empty directory (spec 39: never
 * hide partial side effects after a failure).
 */
export async function cloneRepository(
  input: CloneRepositoryInput,
  executor: GitExecutor,
): Promise<CloneRepositoryResult> {
  validateCloneSource(input.remoteUrl);
  validateCloneDestination(input.destination);
  const args = cloneArgs(input);
  const result = await executor(args, input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {});
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`git clone failed: ${detail}`);
  }
  return { destination: input.destination, stdout: result.stdout, stderr: result.stderr };
}
