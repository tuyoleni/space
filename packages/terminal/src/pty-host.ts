/**
 * PTY host (spec sections 15.1 TERM-001, 15.2 TERM-002, 15.4 TERM-004,
 * 15.5 TERM-005). This is the logical service that owns real shell
 * processes; `apps/desktop/src/main/terminal-worker.ts` is the thin
 * `utilityProcess` entrypoint that wires this host's events to
 * `process.parentPort` (spec section 20.2.4: "Terminal/PTY hosting" is a
 * separate logical service from storage).
 *
 * Spawning is injected (`PtySpawner`) so the host's lifecycle, binding,
 * and backpressure logic is unit-testable without a real shell; a
 * separate hermetic integration test exercises this same host against a
 * real `node-pty` process, the same way the P0-A spike proved node-pty
 * inside a real utilityProcess.
 */
import { randomUUID } from 'node:crypto';
import { RedactionRegistry } from '@space/workspace-runner';
import { BackpressureBuffer } from './backpressure';
import type { TerminalCreateRequest, TerminalWorkerEvent } from './protocol';
import type { TerminalSessionInfo, TerminalSessionState } from './session';

export interface PtyProcessHandle {
  readonly pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { readonly exitCode: number; readonly signal: number | undefined }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
}

/** Never invoked with a renderer-supplied executable path — the worker resolves `shell` itself (TERM-001). */
export type PtySpawner = (shell: string, args: readonly string[], options: PtySpawnOptions) => PtyProcessHandle;

export interface PtyHostOptions {
  readonly spawner: PtySpawner;
  readonly emit: (event: TerminalWorkerEvent) => void;
  /** Per-session cap on unflushed output (spec 15.5 backpressure). Defaults to 256KB. */
  readonly maxBufferedBytesPerSession?: number;
  /** How often buffered output is flushed to `emit` (ms). Defaults to 25ms (~40fps). */
  readonly flushIntervalMs?: number;
  /** Bounded, redacted, in-memory-only tail kept per session for diagnostics — never written to disk (spec 15.5). */
  readonly recentOutputTailBytes?: number;
  readonly redaction?: RedactionRegistry;
  readonly now?: () => string;
  /** Hard cap on concurrently *running* sessions (spec 27.4). Defaults to `DEFAULT_MAX_SIMULTANEOUS_PTYS`. Exited-but-not-yet-disposed sessions do not count against it. */
  readonly maxSimultaneousPtys?: number;
}

interface HostedSession {
  info: TerminalSessionInfo;
  readonly pty: PtyProcessHandle;
  readonly buffer: BackpressureBuffer;
  readonly flushTimer: NodeJS.Timeout;
  sequence: number;
  recentOutputTail: string;
}

const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 25;
const DEFAULT_RECENT_TAIL_BYTES = 4 * 1024;
/**
 * Maximum number of PTY sessions this host will keep alive at once (spec
 * 27.4's resource-limit requirement — an unbounded number of live shells
 * would let a runaway caller exhaust process/file-descriptor limits).
 * Kept in lockstep with `@space/domain`'s `RESOURCE_LIMITS.
 * maxSimultaneousPtys` by convention (this package stays dependency-light
 * on purpose, same reasoning as `AgentActionRisk`/`OperationRisk`).
 */
export const DEFAULT_MAX_SIMULTANEOUS_PTYS = 12;

export class TooManyPtySessionsError extends Error {
  constructor(public readonly limit: number) {
    super(`Cannot create a new terminal session: the limit of ${limit} simultaneous PTY sessions has been reached.`);
    this.name = 'TooManyPtySessionsError';
  }
}

export function defaultShellForPlatform(
  platform: NodeJS.Platform,
  envShell: string | undefined,
): string {
  if (platform === 'win32') {
    return 'powershell.exe';
  }
  return envShell && envShell.trim().length > 0 ? envShell : '/bin/zsh';
}

export class PtyHost {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly redaction: RedactionRegistry;
  private readonly maxBufferedBytesPerSession: number;
  private readonly flushIntervalMs: number;
  private readonly recentOutputTailBytes: number;
  private readonly now: () => string;
  private readonly maxSimultaneousPtys: number;

  constructor(private readonly options: PtyHostOptions) {
    this.redaction = options.redaction ?? new RedactionRegistry();
    this.maxBufferedBytesPerSession = options.maxBufferedBytesPerSession ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.recentOutputTailBytes = options.recentOutputTailBytes ?? DEFAULT_RECENT_TAIL_BYTES;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxSimultaneousPtys = options.maxSimultaneousPtys ?? DEFAULT_MAX_SIMULTANEOUS_PTYS;
  }

  /** Number of sessions currently in the `running` state — exited-but-undisposed sessions never count against the limit. */
  get runningSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.info.state === 'running') {
        count += 1;
      }
    }
    return count;
  }

  create(request: TerminalCreateRequest, platform: NodeJS.Platform = process.platform): TerminalSessionInfo {
    if (this.runningSessionCount >= this.maxSimultaneousPtys) {
      throw new TooManyPtySessionsError(this.maxSimultaneousPtys);
    }
    const shell = request.shell ?? defaultShellForPlatform(platform, request.env['SHELL']);
    const pty = this.options.spawner(shell, request.args ?? [], {
      cwd: request.cwd,
      env: request.env,
      cols: request.cols,
      rows: request.rows,
    });

    const id = randomUUID();
    const startedAt = this.now();
    const info: TerminalSessionInfo = {
      id,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      shell,
      cwd: request.cwd,
      pid: pty.pid,
      state: 'running',
      startedAt,
      endedAt: null,
      exitCode: null,
      lastOutputAt: null,
      runningForegroundOperation: null,
    };

    const buffer = new BackpressureBuffer({ maxBufferedBytes: this.maxBufferedBytesPerSession });
    const flushTimer = setInterval(() => this.flush(id), this.flushIntervalMs);
    // Node keeps the process alive while an interval is pending; the host
    // is long-lived inside the terminal worker so that's the desired
    // behaviour, but tests should still be able to exit cleanly.
    flushTimer.unref?.();

    const session: HostedSession = { info, pty, buffer, flushTimer, sequence: 0, recentOutputTail: '' };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.buffer.push(data);
      session.info = { ...session.info, lastOutputAt: this.now() };
    });
    pty.onExit(({ exitCode, signal }) => {
      this.flush(id);
      session.info = {
        ...session.info,
        state: 'exited',
        endedAt: this.now(),
        exitCode,
      };
      clearInterval(session.flushTimer);
      this.options.emit({
        kind: 'event',
        type: 'exit',
        sessionId: id,
        exitCode,
        signal: signal ?? null,
        timestamp: this.now(),
      });
    });

    return info;
  }

  private flush(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    const result = session.buffer.flush();
    if (!result) {
      return;
    }
    if (result.droppedBytes > 0) {
      this.options.emit({
        kind: 'event',
        type: 'backpressure',
        sessionId,
        droppedBytes: result.droppedBytes,
        timestamp: this.now(),
      });
    }
    if (result.text.length > 0) {
      session.sequence += 1;
      session.recentOutputTail = this.redaction.redact(
        `${session.recentOutputTail}${result.text}`.slice(-this.recentOutputTailBytes),
      );
      this.options.emit({
        kind: 'event',
        type: 'output',
        sessionId,
        chunk: result.text,
        sequence: session.sequence,
        timestamp: this.now(),
      });
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId);
    if (session.info.state !== 'running') {
      throw new Error(`Cannot write to terminal session ${sessionId}: it has already exited`);
    }
    session.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.requireSession(sessionId);
    session.pty.resize(cols, rows);
  }

  dispose(sessionId: string): void {
    const session = this.requireSession(sessionId);
    if (session.info.state === 'running') {
      session.pty.kill();
    }
    clearInterval(session.flushTimer);
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
  }

  get(sessionId: string): TerminalSessionInfo | null {
    return this.sessions.get(sessionId)?.info ?? null;
  }

  /** Bounded, redacted diagnostic tail — never the full session history (spec 15.5). */
  recentOutputTail(sessionId: string): string {
    return this.requireSession(sessionId).recentOutputTail;
  }

  /** For a clean worker shutdown: kills every still-running session. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      const session = this.sessions.get(id);
      if (session?.info.state === 'running') {
        this.dispose(id);
      } else if (session) {
        clearInterval(session.flushTimer);
      }
    }
  }

  private requireSession(sessionId: string): HostedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }
    return session;
  }
}

export type { TerminalSessionState };
