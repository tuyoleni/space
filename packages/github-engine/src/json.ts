/**
 * Shared `gh` invocation helpers. Space prefers `gh`'s structured `--json`
 * output over parsing colored/human terminal text wherever the CLI
 * supports it (spec 14.5's "should use structured JSON output"; spec 39
 * prohibits parsing terminal-coloured human output when a stable
 * machine-readable form exists). Callers that must fall back to text
 * (e.g. `gh auth status`, which has no `--json` form) document that
 * explicitly at the call site rather than silently degrading everywhere.
 */
import type { GhCommandResult, GhExecutor } from './executor';

export class GhCommandError extends Error {
  constructor(
    public readonly args: readonly string[],
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly stdout: string,
  ) {
    super(`gh ${args.join(' ')} failed: ${stderr.trim() || stdout.trim() || `exit code ${exitCode}`}`);
    this.name = 'GhCommandError';
  }
}

export interface GhRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

/** Runs `gh <args>` and throws `GhCommandError` on a non-zero exit. */
export async function runGh(executor: GhExecutor, args: readonly string[], options?: GhRunOptions): Promise<GhCommandResult> {
  const result = await executor(args, options);
  if (result.exitCode !== 0) {
    throw new GhCommandError(args, result.exitCode, result.stderr, result.stdout);
  }
  return result;
}

/** Runs `gh <args>` (which must include a `--json ...` flag) and parses stdout as JSON. */
export async function runGhJson<T>(executor: GhExecutor, args: readonly string[], options?: GhRunOptions): Promise<T> {
  const result = await runGh(executor, args, options);
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Like `runGh`, but resolves to `null` on failure instead of throwing — for "where obtainable" spec language (e.g. org listing that may 404 for a personal account). */
export async function runGhJsonOptional<T>(
  executor: GhExecutor,
  args: readonly string[],
  options?: GhRunOptions,
): Promise<T | null> {
  try {
    return await runGhJson<T>(executor, args, options);
  } catch {
    return null;
  }
}
