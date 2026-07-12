/**
 * Long-running ("detached" in spec 21.2's `mode` sense — not Node's
 * `detached` spawn option) process support for PRJ-006 development
 * servers. `runProcess` in runner.ts resolves only once the process exits,
 * which doesn't fit a dev server the user wants to keep running and later
 * stop/restart; this module spawns without waiting, streams output to
 * listeners, and lets the caller kill it on demand — the same
 * shell:false/argument-array/DI-resolver discipline as runProcess.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { ExecutableResolver, ProcessRequest } from './types';

export type OutputStream = 'stdout' | 'stderr';
export type OutputListener = (chunk: string, stream: OutputStream) => void;
export type ExitListener = (exitCode: number | null) => void;

/** Minimal surface this module needs from a child process — narrow enough to fake in tests. */
export interface ChildProcessLike {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env: Readonly<Record<string, string>> },
) => ChildProcessLike;

export interface DetachedProcessHandle {
  readonly pid: number;
  readonly operationId: string;
  onOutput(listener: OutputListener): void;
  onExit(listener: ExitListener): void;
  kill(signal?: NodeJS.Signals): void;
}

export interface StartDetachedOptions {
  readonly resolveExecutable: ExecutableResolver;
  readonly spawner?: ProcessSpawner;
}

function defaultSpawner(
  executable: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env: Readonly<Record<string, string>> },
): ChildProcessLike {
  return spawn(executable, [...args], {
    cwd: options.cwd,
    env: { ...options.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcess;
}

/**
 * Spawns `request` without waiting for it to exit. The caller owns the
 * returned handle's lifecycle — nothing here persists anything; the
 * caller attaches output/exit to a durable process record itself (PRJ-006:
 * "attach output to a durable process record").
 */
export async function startDetachedProcess(
  request: ProcessRequest,
  options: StartDetachedOptions,
): Promise<DetachedProcessHandle> {
  const executable = await options.resolveExecutable(request.executableId);
  const spawner = options.spawner ?? defaultSpawner;
  const child = spawner(
    executable,
    request.args,
    request.cwd !== undefined ? { cwd: request.cwd, env: request.env } : { env: request.env },
  );
  if (child.pid === undefined) {
    throw new Error(`Failed to start detached process "${executable}": no pid was assigned`);
  }

  const outputListeners = new Set<OutputListener>();
  const exitListeners = new Set<ExitListener>();

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    for (const listener of outputListeners) listener(text, 'stdout');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    for (const listener of outputListeners) listener(text, 'stderr');
  });
  child.on('exit', (code) => {
    for (const listener of exitListeners) listener(code);
  });

  return {
    pid: child.pid,
    operationId: request.operationId,
    onOutput: (listener) => {
      outputListeners.add(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
    },
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

const LISTENING_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s"'<>]*/i;

/**
 * PRJ-006: "Detect the listening URL from structured configuration or
 * output." Output-based detection here is the fallback; structured
 * config-based detection is project/framework-specific and left to a
 * later milestone. Only ever matches localhost/loopback so a dev server
 * is never assumed reachable from outside the machine.
 */
export function detectListeningUrl(text: string): string | null {
  const match = LISTENING_URL_PATTERN.exec(text);
  return match ? match[0] : null;
}
