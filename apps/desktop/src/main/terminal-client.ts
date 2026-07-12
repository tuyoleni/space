/**
 * Main-process client for the terminal worker (spec sections 15, 20.2.4).
 * Structured like StorageClient (request correlation, timeouts, bounded
 * crash-respawn) plus a `subscribe(sessionId, listener): Unsubscribe` fan-
 * out for the worker's push events — the shape spec section 22.2 uses for
 * `operation.subscribe`, because terminal output is a stream.
 *
 * TERM-004: a crashed terminal worker cannot be assumed to have any
 * recoverable live PTY — every session this client still believed was
 * running gets a synthetic exit event so subscribers (and the renderer)
 * see an honest, terminal state rather than silence.
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  TerminalWorkerEvent,
  TerminalWorkerMethod,
  TerminalWorkerMessage,
  TerminalWorkerRequest,
} from '@space/terminal';

const MAX_RESPAWNS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export type TerminalEventListener = (event: TerminalWorkerEvent) => void;
export type Unsubscribe = () => void;

export class TerminalClient {
  private worker: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<TerminalEventListener>>();
  private readonly liveSessionIds = new Set<string>();
  private respawnCount = 0;

  constructor(private readonly workerPath: string) {}

  start(): void {
    this.spawn();
  }

  stop(): void {
    this.worker?.kill();
    this.worker = null;
  }

  async call<T>(method: TerminalWorkerMethod, payload: unknown): Promise<T> {
    if (!this.worker) {
      throw new Error('terminal worker is not running');
    }
    const id = randomUUID();
    const request: TerminalWorkerRequest = { id, method, payload };
    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`terminal worker timed out responding to "${method}"`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker?.postMessage(request);
    });
    if (method === 'terminal.create') {
      this.liveSessionIds.add((result as { id: string }).id);
    }
    if (method === 'terminal.dispose') {
      this.liveSessionIds.delete((request.payload as { sessionId: string }).sessionId);
    }
    return result as T;
  }

  /** Mirrors spec 22.2's operation.subscribe(id, listener): Unsubscribe. */
  subscribe(sessionId: string, listener: TerminalEventListener): Unsubscribe {
    const set = this.listeners.get(sessionId) ?? new Set<TerminalEventListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  private spawn(): void {
    const worker = utilityProcess.fork(this.workerPath, [], { stdio: 'pipe' });
    worker.on('message', (message: TerminalWorkerMessage) => this.handleMessage(message));
    worker.on('exit', (code) => this.handleExit(code));
    this.worker = worker;
  }

  private handleMessage(message: TerminalWorkerMessage): void {
    if (message.kind === 'event') {
      if (message.type === 'exit') {
        this.liveSessionIds.delete(message.sessionId);
      }
      this.dispatch(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error));
    }
  }

  private dispatch(event: TerminalWorkerEvent): void {
    const set = this.listeners.get(event.sessionId);
    if (!set) {
      return;
    }
    for (const listener of set) {
      listener(event);
    }
  }

  private handleExit(code: number): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`terminal worker exited (code ${code}) before responding`));
    }
    this.pending.clear();
    this.worker = null;

    // TERM-004: a crashed worker's PTYs are gone, not recoverable — tell
    // every subscriber of a session we still believed was live.
    const timestamp = new Date().toISOString();
    for (const sessionId of [...this.liveSessionIds]) {
      this.dispatch({ kind: 'event', type: 'exit', sessionId, exitCode: null, signal: null, timestamp });
    }
    this.liveSessionIds.clear();

    if (this.respawnCount < MAX_RESPAWNS) {
      this.respawnCount += 1;
      this.spawn();
    }
  }
}
