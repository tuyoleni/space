/**
 * Real (non-fake) `GhExecutor` backed by `node:child_process.spawn`, the
 * only place in this package that actually shells out to `gh`. Mirrors
 * `@space/git-engine`'s `node-git-executor.ts` convention: production
 * wiring lives in one small file so every algorithmic module stays
 * test-only DI.
 */
import { spawn } from 'node:child_process';
import type { GhCommandResult, GhExecutor } from './executor';

export function createNodeGhExecutor(ghExecutablePath = 'gh'): GhExecutor {
  return (args, options) =>
    new Promise<GhCommandResult>((resolve, reject) => {
      const child = spawn(ghExecutablePath, [...args], {
        cwd: options?.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options?.env ? { ...process.env, ...options.env } : process.env,
      });
      let stdout = '';
      let stderr = '';
      const timeout = options?.timeoutMs
        ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
        : undefined;

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
