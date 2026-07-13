/**
 * A bounded on-disk cache directory for downloaded installer/tool
 * artifacts (spec 27.4's "install/download cache" resource limit, ADR-004's
 * "download verification"). No installer in this codebase downloads files
 * directly yet — bootstrap installation goes through platform package
 * managers (Homebrew/winget), which manage their own caches — but the
 * official-fallback-installer path ADR-004 documents (and any future
 * curated-template or release-asset download) needs a cache with a real,
 * enforced ceiling rather than an unbounded directory, so this exists as
 * the one sanctioned implementation ready to be pointed at a real
 * directory. All filesystem access is injected (`DownloadCacheFs`) so this
 * is unit-testable without touching a real disk, matching every other I/O
 * seam in this codebase.
 */

export interface DownloadCacheEntryStat {
  readonly name: string;
  readonly sizeBytes: number;
  /** Last-accessed or last-modified time, used to decide eviction order — epoch milliseconds. */
  readonly touchedAtMs: number;
}

export interface DownloadCacheFs {
  listEntries(dir: string): DownloadCacheEntryStat[];
  remove(dir: string, name: string): void;
}

/**
 * Maximum total bytes the cache directory may hold (spec 27.4). Kept in
 * lockstep with `@space/domain`'s `RESOURCE_LIMITS.
 * maxInstallDownloadCacheBytes` by convention (this package stays
 * dependency-light on purpose, same reasoning as `AgentActionRisk`/
 * `OperationRisk`).
 */
export const DEFAULT_MAX_INSTALL_DOWNLOAD_CACHE_BYTES = 512 * 1024 * 1024;

export interface EvictionPlan {
  readonly toRemove: readonly string[];
  readonly bytesFreed: number;
  readonly remainingBytes: number;
}

/**
 * Pure decision: given the current entries and a byte ceiling, which
 * least-recently-touched entries must be removed to get back under the
 * limit. Never removes more than necessary.
 */
export function planEviction(entries: readonly DownloadCacheEntryStat[], maxBytes: number): EvictionPlan {
  const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  if (totalBytes <= maxBytes) {
    return { toRemove: [], bytesFreed: 0, remainingBytes: totalBytes };
  }
  const sortedOldestFirst = [...entries].sort((a, b) => a.touchedAtMs - b.touchedAtMs);
  const toRemove: string[] = [];
  let remaining = totalBytes;
  for (const entry of sortedOldestFirst) {
    if (remaining <= maxBytes) {
      break;
    }
    toRemove.push(entry.name);
    remaining -= entry.sizeBytes;
  }
  return { toRemove, bytesFreed: totalBytes - remaining, remainingBytes: remaining };
}

/**
 * Applies `planEviction`'s result against the injected filesystem port,
 * removing the oldest entries until the directory is back under
 * `maxBytes`. Returns the plan that was applied, for logging/tests.
 */
export function enforceDownloadCacheLimit(fs: DownloadCacheFs, dir: string, maxBytes: number = DEFAULT_MAX_INSTALL_DOWNLOAD_CACHE_BYTES): EvictionPlan {
  const entries = fs.listEntries(dir);
  const plan = planEviction(entries, maxBytes);
  for (const name of plan.toRemove) {
    fs.remove(dir, name);
  }
  return plan;
}
