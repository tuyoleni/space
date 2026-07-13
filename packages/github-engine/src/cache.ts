/**
 * A bounded, in-memory cache for GitHub CLI/API responses (spec 27.4's
 * "GitHub cache size" resource limit; spec 14.11's "cached GitHub data is
 * labelled with its last-refresh time" — this is the retention bound meant
 * to sit underneath `labelWithLastRefresh` in `connectivity.ts`). Least-
 * recently-used eviction via `Map`'s insertion-order iteration: a `get`
 * that hits re-inserts the entry at the end, so the oldest untouched entry
 * is always the first one evicted once the cache is full — that ceiling is
 * real and tested (`cache.test.ts`) independent of any caller.
 *
 * Not yet wired into a real call site: `apps/desktop/src/main/
 * github-handlers.ts` still calls `gh` fresh on every read today (list
 * PRs/issues/runs/workflows), the same as it did in M6. Actually caching
 * those reads is a product behaviour change (staleness trade-offs per
 * endpoint) that deserves its own verified pass with a running app, not a
 * blind wire-up during a hardening milestone — same reasoning
 * `download-cache.ts` documents for its own not-yet-wired state. This
 * class is the one sanctioned implementation ready to be pointed at real
 * `gh` calls when that pass happens.
 */
export interface CachedGithubEntry<T> {
  readonly data: T;
  readonly lastRefreshedAt: string;
}

/**
 * Maximum number of cached responses retained at once (spec 27.4). Kept
 * in lockstep with `@space/domain`'s `RESOURCE_LIMITS.githubCacheMaxEntries`
 * by convention (this package stays dependency-light on purpose, same
 * reasoning as `AgentActionRisk`/`OperationRisk`).
 */
export const DEFAULT_GITHUB_CACHE_MAX_ENTRIES = 200;

export class BoundedGithubCache<T> {
  private readonly entries = new Map<string, CachedGithubEntry<T>>();

  constructor(private readonly maxEntries: number = DEFAULT_GITHUB_CACHE_MAX_ENTRIES) {
    if (maxEntries < 1) {
      throw new Error('BoundedGithubCache requires maxEntries >= 1');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CachedGithubEntry<T> | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    // Refresh recency on read.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, data: T, lastRefreshedAt: string): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, { data, lastRefreshedAt });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
