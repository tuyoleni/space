/**
 * DI seam for the real OS credential-store CLI (spec 24.1: "use the
 * operating system credential store through a reviewed abstraction").
 * Mirrors `@space/git-engine`'s `GitExecutor`/`node-git-executor.ts` and
 * `@space/github-engine`'s `GhExecutor`/`node-gh-executor.ts` exactly: a
 * structured-args executor type plus one real `spawn`-backed
 * implementation, so `keychain-credential-store.ts`'s logic is unit-
 * tested against a fake here and never calls a real keychain in tests.
 */
import { spawn } from 'node:child_process';

export interface OsCredentialCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type OsCredentialExecutor = (
  executable: string,
  args: readonly string[],
  options?: { readonly input?: string },
) => Promise<OsCredentialCommandResult>;

/**
 * The only place in this package that actually spawns a platform
 * credential-store CLI. `keychain-credential-store.ts` decides which
 * `executable`/`args` to pass per platform; this function just runs it.
 */
export function createNodeOsCredentialExecutor(): OsCredentialExecutor {
  return (executable, args, options) =>
    new Promise<OsCredentialCommandResult>((resolve, reject) => {
      const child = spawn(executable, [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      if (options?.input !== undefined) {
        child.stdin?.write(options.input);
      }
      child.stdin?.end();

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', (error) => reject(error));
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    });
}
