/**
 * Main-process client for the storage worker (ADR-003). The main process
 * never opens the database itself — every call crosses into the worker
 * via this class. Crash recovery follows the P0-A spike's bounded-retry
 * pattern (spec section 20.2.4: "restarts workers with bounded policy").
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { StorageMethod, StorageRequest, StorageResponse } from './storage-protocol';

const MAX_RESPAWNS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
/** A crash streak older than this gets a fresh respawn budget on the next call — a transient startup failure (e.g. a dying previous instance still holding the SQLite lock) must not permanently kill storage for the whole session. */
const RESPAWN_BUDGET_WINDOW_MS = 30_000;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class StorageClient {
  private worker: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private respawnCount = 0;
  private lastCrashAt = 0;
  private stopped = false;

  constructor(
    private readonly workerPath: string,
    private readonly dbPath: string,
  ) {}

  start(): void {
    this.stopped = false;
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    this.worker?.kill();
    this.worker = null;
  }

  async call<T>(method: StorageMethod, payload: unknown): Promise<T> {
    if (!this.worker && !this.stopped && Date.now() - this.lastCrashAt > RESPAWN_BUDGET_WINDOW_MS) {
      // The crash streak that exhausted the budget is long over — try once
      // more rather than staying dead for the rest of the session.
      this.respawnCount = 0;
      this.spawn();
    }
    if (!this.worker) {
      throw new Error('storage worker is not running');
    }
    const id = randomUUID();
    const request: StorageRequest = { id, method, payload };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`storage worker timed out responding to "${method}"`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.worker?.postMessage(request);
    });
  }

  private spawn(): void {
    const worker = utilityProcess.fork(this.workerPath, [this.dbPath], { stdio: 'pipe' });
    // Without this, a crashing worker dies silently — its stderr (the only
    // place the actual failure reason appears, e.g. a native-module ABI
    // mismatch or a locked database file) was piped to nothing.
    worker.stderr?.on('data', (chunk: Buffer) => {
      console.error('[storage-worker]', chunk.toString().trimEnd());
    });
    worker.on('message', (message: StorageResponse) => this.handleMessage(message));
    worker.on('exit', (code) => this.handleExit(code));
    this.worker = worker;
  }

  private handleMessage(message: StorageResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    // Any completed round-trip proves the worker is healthy — a later
    // crash streak deserves a fresh respawn budget, not the leftovers of
    // one it already recovered from.
    this.respawnCount = 0;
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error));
    }
  }

  /** A crashed worker fails every in-flight call; a fresh one is spawned up to MAX_RESPAWNS times. */
  private handleExit(code: number): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`storage worker exited (code ${code}) before responding`));
    }
    this.pending.clear();
    this.worker = null;
    this.lastCrashAt = Date.now();

    if (this.respawnCount < MAX_RESPAWNS) {
      this.respawnCount += 1;
      this.spawn();
    }
  }
}
