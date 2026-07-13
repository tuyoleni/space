/**
 * Concrete, numeric resource limits (spec section 27.4: "The team must
 * define and test limits for: maximum retained operation output, activity
 * retention, GitHub cache size, number of simultaneous PTYs, concurrent
 * repository reads, install/download cache."). This module is the single
 * documented source of truth for each constant's *value*; the packages
 * that actually enforce a given limit (`@space/storage`, `@space/terminal`,
 * `@space/git-engine`, `@space/github-engine`, `@space/environment`)
 * define and test their own local copy rather than importing this one —
 * the same "kept in lockstep by convention, not by a shared I/O-free-vs-
 * privileged-package dependency" pattern `AgentActionRisk`/`OperationRisk`
 * already established (see `agent-confirmation.ts`'s header comment).
 * Each enforcing package's own constant carries a comment pointing back
 * here.
 */
export const RESOURCE_LIMITS = {
  /** Bytes of `partialState`/error/stdout text retained per operation receipt before truncation (spec 27.4). */
  maxRetainedOperationOutputBytes: 64 * 1024,
  /** Days of activity history retained before pruning (spec 27.4, 17.4 "activity is local by default"). */
  activityRetentionDays: 400,
  /** Maximum number of cached GitHub API/CLI responses retained at once (spec 27.4, 14.11's "cached GitHub data"). */
  githubCacheMaxEntries: 200,
  /** Maximum number of PTY sessions the terminal host will keep alive at once (spec 27.4). */
  maxSimultaneousPtys: 12,
  /** Maximum number of concurrent non-mutating repository reads (status/log/diff) across all repositories (spec 27.4, 11.13). */
  maxConcurrentRepositoryReads: 6,
  /** Maximum total bytes the install/download cache directory may hold before oldest entries are evicted (spec 27.4, ADR-004). */
  maxInstallDownloadCacheBytes: 512 * 1024 * 1024,
} as const;

export type ResourceLimitKey = keyof typeof RESOURCE_LIMITS;
