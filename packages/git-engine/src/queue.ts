/**
 * Git operation queue (spec 11.13). Mutating operations for the same
 * repository are serialised through a per-repository lock (never one
 * global lock, so two different repositories' commits never block each
 * other); status refreshes for the same repository are coalesced so a
 * burst of watcher events triggers one `git status` in flight, not one per
 * event. Read operations that cannot conflict with anything (e.g. `git
 * log`, `git diff` against a fixed ref) simply never go through this
 * queue — only mutation and status-refresh call sites need to.
 */

export class RepositoryOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly inFlightStatusRefresh = new Map<string, Promise<unknown>>();

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

  /** Number of distinct repositories this queue has ever serialised a mutating operation for — for tests/diagnostics. */
  get trackedRepositoryCount(): number {
    return this.tails.size;
  }
}
