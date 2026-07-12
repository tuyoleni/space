/**
 * History cache port (spec 12.5, ADR-007). The decision recorded in
 * ADR-007 is: cache the fully-parsed commit list keyed by repository and
 * invalidated by HEAD SHA, so a previously-indexed repository can paint
 * its history view before a single `git log` runs. The real
 * implementation lives in `fs-history-cache.ts` (one small file that
 * touches the filesystem, matching `node-git-executor.ts`'s convention);
 * everything else — including `HistoryStore` — only depends on this port.
 */
import type { CommitNode } from './types';

export interface HistoryCacheEntry {
  readonly headSha: string;
  readonly commits: readonly CommitNode[];
}

export interface HistoryCachePort {
  read(repoKey: string): Promise<HistoryCacheEntry | null>;
  write(repoKey: string, entry: HistoryCacheEntry): Promise<void>;
}

/** In-memory cache for tests and for callers that don't want disk persistence. */
export function createInMemoryHistoryCache(): HistoryCachePort {
  const store = new Map<string, HistoryCacheEntry>();
  return {
    read: async (repoKey) => store.get(repoKey) ?? null,
    write: async (repoKey, entry) => {
      store.set(repoKey, entry);
    },
  };
}
