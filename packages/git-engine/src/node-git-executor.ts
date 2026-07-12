/**
 * Real (non-fake) `GitExecutor` backed by `node:child_process.spawn`, the
 * only place in this package that actually shells out to `git`. Mirrors
 * `@space/environment`'s `node-adapters.ts` convention: production wiring
 * lives in one small file so every algorithmic module stays test-only DI.
 */
import { spawn } from 'node:child_process';
import type { GitCommandResult, GitExecutor } from './clone';

export function createNodeGitExecutor(gitExecutablePath = 'git'): GitExecutor {
  return (args, options) =>
    new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn(gitExecutablePath, [...args], {
        cwd: options?.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = options?.timeoutMs
        ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
        : undefined;

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
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        resolve({ exitCode: code, stdout, stderr });
      });
    });
}
