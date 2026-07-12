/**
 * Minimal Workspace Process Runner core (spec section 21), seeded by the
 * P0-C spike. Executes a structured request: executable + argument array,
 * shell disabled, environment supplied explicitly by the caller (built via
 * @space/domain buildEnvironment), bounded output, redaction, cancellation,
 * and a receipt for every run.
 */
import { spawn } from 'node:child_process';
import { RedactionRegistry } from './redaction';
import type { ExecutableResolver, ProcessReceipt, ProcessRequest } from './types';

const MAX_CAPTURED_BYTES = 1024 * 1024;

export interface RunOptions {
  readonly resolveExecutable: ExecutableResolver;
  readonly redaction?: RedactionRegistry;
  readonly signal?: AbortSignal;
}

export async function runProcess(
  request: ProcessRequest,
  options: RunOptions,
): Promise<ProcessReceipt> {
  const executable = await options.resolveExecutable(request.executableId);
  const redaction = options.redaction ?? new RedactionRegistry();
  const startedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...request.args], {
      cwd: request.cwd,
      env: { ...request.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let cancelled = false;
    let settled = false;

    const capture = (target: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (target === 'stdout' && stdout.length < MAX_CAPTURED_BYTES) {
        stdout += text;
      } else if (target === 'stderr' && stderr.length < MAX_CAPTURED_BYTES) {
        stderr += text;
      }
    };
    child.stdout?.on('data', capture('stdout'));
    child.stderr?.on('data', capture('stderr'));

    const timeout =
      request.timeoutMs !== undefined
        ? setTimeout(() => {
            cancelled = true;
            child.kill('SIGTERM');
          }, request.timeoutMs)
        : undefined;

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        operationId: request.operationId,
        workspaceId: request.workspaceId,
        executable,
        commandDisplay: redaction.redact(`${executable} ${request.args.join(' ')}`),
        state: cancelled ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed',
        exitCode,
        startedAt,
        endedAt: new Date().toISOString(),
        stdout: redaction.redact(stdout),
        stderr: redaction.redact(stderr),
      });
    };

    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (code) => finish(code));
  });
}
