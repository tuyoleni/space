/**
 * Git operation queue (spec 11.13). Mutating operations for the same
 * repository are serialised through a per-repository lock (never one
 * global lock, so two different repositories' commits never block each
 * other); status refreshes for the same repository are coalesced so a
 * burst of watcher events triggers one `git status` in flight, not one per
 * event. Reads that cannot conflict with anything (e.g. `git log`, `git
 * diff` against a fixed ref) never serialise per-repository, but they do
 * share one global cap across every repository (spec 27.4's "concurrent
 * repository reads" resource limit) via `enqueueRead` — a burst of reads
 * across many open projects at once (e.g. refreshing several history
 * panes simultaneously) must not spawn unbounded `git` child processes.
 */

/**
 * Maximum number of non-mutating repository reads allowed in flight at
 * once, across every repository (spec 27.4). Kept in lockstep with
 * `@space/domain`'s `RESOURCE_LIMITS.maxConcurrentRepositoryReads` by
 * convention (this package stays dependency-light on purpose, same
 * reasoning as `AgentActionRisk`/`OperationRisk`).
 */
export const DEFAULT_MAX_CONCURRENT_REPOSITORY_READS = 6;

/**
 * A simple counting semaphore: `acquire()` resolves once a slot is free,
 * `release()` (always called in the caller's `finally`) frees it for the
 * next waiter, in FIFO order.
 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available -= 1;
  }

  release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  get inFlight(): number {
    return this.limit - this.available;
  }
}

export interface RepositoryOperationQueueOptions {
  readonly maxConcurrentReads?: number;
}

export class RepositoryOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly inFlightStatusRefresh = new Map<string, Promise<unknown>>();
  private readonly readSemaphore: Semaphore;

  constructor(options: RepositoryOperationQueueOptions = {}) {
    this.readSemaphore = new Semaphore(options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_REPOSITORY_READS);
  }

  /**
   * Runs `operation` after every previously enqueued mutating operation for
   * `repoKey` has settled (success or failure never blocks the next one).
   * The caller's own promise resolves/rejects with `operation`'s real
   * outcome; only the internal chain swallows errors so the queue itself
   * never gets stuck.
   */
  async enqueueMutating<T>(repoKey: string, operation: () => Promise<T>): Promise<T> {
    const previousTail = this.tails.get(repoKey) ?? Promise.resolve();
    const settled = previousTail.then(operation, operation);
    this.tails.set(
      repoKey,
      settled.then(
        () => undefined,
        () => undefined,
      ),
    );
    return settled;
  }

  /**
   * Coalesces concurrent status-refresh requests for the same repository:
   * if one is already in flight, every caller shares its result instead of
   * each starting a fresh `git status` (spec 11.13: "status refreshes must
   * be coalesced").
   */
  async coalesceStatusRefresh<T>(repoKey: string, operation: () => Promise<T>): Promise<T> {
    const inFlight = this.inFlightStatusRefresh.get(repoKey);
    if (inFlight) {
      return inFlight as Promise<T>;
    }
    const promise = operation().finally(() => {
      this.inFlightStatusRefresh.delete(repoKey);
    });
    this.inFlightStatusRefresh.set(repoKey, promise);
    return promise;
  }

  /**
   * Runs a non-mutating read under the global concurrent-read cap (spec
   * 27.4) — bounded across every repository, not per-repository. Extra
   * callers beyond the cap simply wait their turn (FIFO), never rejected.
   */
  async enqueueRead<T>(operation: () => Promise<T>): Promise<T> {
    await this.readSemaphore.acquire();
    try {
      return await operation();
    } finally {
      this.readSemaphore.release();
    }
  }

  /** In-flight concurrent reads right now — for tests/diagnostics. */
  get inFlightReadCount(): number {
    return this.readSemaphore.inFlight;
  }

  /** Number of distinct repositories this queue has ever serialised a mutating operation for — for tests/diagnostics. */
  get trackedRepositoryCount(): number {
    return this.tails.size;
  }
}
