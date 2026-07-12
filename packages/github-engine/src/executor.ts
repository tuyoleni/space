/**
 * Real `gh` (GitHub CLI) support (spec section 14). Mirrors
 * `@space/git-engine`'s `GitExecutor`/`node-git-executor.ts` DI pattern
 * exactly: process spawning is injected so every algorithmic module in
 * this package never shells out in a unit test, and this file is the only
 * place that actually spawns `gh`.
 *
 * Command construction never concatenates a shell string (spec 21.3):
 * arguments are always an array. `env` lets a caller inject `GH_TOKEN` and
 * `GH_CONFIG_DIR` per workspace at runtime (spec 5.6) without ever writing
 * either into a shell string or a persisted file.
 */

export interface GhCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type GhExecutor = (
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    /** Merged over the inherited environment; never replaces it wholesale (so PATH etc. survive). */
    readonly env?: Readonly<Record<string, string>>;
  },
) => Promise<GhCommandResult>;
