# ADR-007: Git history indexing and cache

## Status
Accepted — resolved during M5 (Phase 4: complete local Git)

## Context
Spec section 40.7: decide memory/disk cache, invalidation, pagination, and large-repository
strategy. Section 12.5 requires the graph to remain responsive with at least 100,000 indexed
commits, rendering only the visible window, with initial visible history appearing before full
repository indexing completes.

## Decision

**Source of truth and indexing shape.** `HistoryStore` (`packages/git-engine/src/history/store.ts`)
is the single owner of a repository's indexed commit list. It never re-derives history from `git
log --graph`; it parses `git log --all --topo-order --date-order --parents --decorate=full
--format=...` (the P0-D-proven format) into `CommitNode[]` and feeds pages into `LaneLayout`
incrementally, so lane assignments stay stable as more history streams in rather than being
recomputed from scratch on every page (spec 12.4).

**Pagination.** Commits are fetched in fixed-size pages via `--skip=N -n COUNT` against a single
`git log --all --topo-order --date-order` invocation. This is safe only because that flag
combination produces a deterministic total order for a fixed ref/commit graph — recorded here as
the load-bearing assumption. `loadInitial(visibleCount)` fetches just enough for the first visible
window synchronously, returns that page immediately (spec 12.5: "initial visible history should
appear before full repository indexing completes"), then kicks off `indexRemaining()` in the
background without blocking the caller. All page fetches — whether from `loadInitial`'s background
indexing or an on-demand `getPage` — are serialized through one `indexingChain` promise so `skip`
offsets are always computed from the true current length, never racing two concurrent `git log`
invocations against the same repository.

**Memory cache.** The full indexed commit list and its lane rows live in memory on the
`HistoryStore` instance for the lifetime of that repository's session. There is no separate LRU/
windowing memory cache in v1: at 100,000 commits the parsed `CommitNode[]` and lane rows are a few
tens of MB, well within budget for a single active repository, and the renderer is responsible for
only rendering the visible window from this in-memory array (spec 12.5: "rendering only the visible
window" is a rendering-layer concern, not a store-layer one).

**Disk cache.** `HistoryCachePort` (`history/cache.ts`) is a narrow read/write interface — one JSON
blob per repository, keyed by a caller-supplied stable `repoKey` (e.g. a hash of the repository's
canonical path) — with `createFsHistoryCache` (`history/fs-history-cache.ts`) as the only real
filesystem-touching implementation, mirroring `node-git-executor.ts`'s convention that exactly one
small file per capability does real I/O. The cached entry is `{ headSha, commits }`: the full
parsed commit list plus the repository's `HEAD` SHA at write time.

**Invalidation.** The disk cache is validated, not trusted blindly: `loadInitial` first resolves
the repository's *current* `HEAD` SHA via `rev-parse HEAD`, reads the cache entry, and only accepts
it if `cached.headSha === currentHeadSha`. Any mismatch — a new commit, a pull, a branch switch,
anything that moved `HEAD` — falls through to a real `git log` and a fresh background index. This
is a whole-repository invalidation, not incremental: v1 deliberately does not attempt to diff two
histories and patch in just the new commits. `HistoryStore.invalidate()` resets in-memory state and
is wired to the repository watcher's `git-dir` change hint (spec 11.12) — a watcher hint never
mutates state directly, it only tells the caller to invalidate and reload. Simpler and always
correct, at the cost of re-walking full history on every `HEAD` move rather than patching deltas;
acceptable because the common case (opening a previously-indexed repository with no new commits)
is the one the cache actually optimizes, and a full re-index still shows the first page instantly
via the same `loadInitial` background-indexing path.

**Cache write timing.** The disk cache is only written once a page fetch observes fewer commits
than the requested page size (i.e. indexing has reached the end of history), and the write is
awaited *before* `isFullyIndexed` flips to `true` — not after — so that any caller treating
`isFullyIndexed` as a signal that the cache is now durable (as the M5 integration test does) never
observes a false positive.

**Large-repository strategy.** No repository size limit is enforced. The 100,000-commit target
(spec 12.5) is met by: (1) parsing once with a single `git log` process rather than N per-commit
invocations, (2) paginating so the UI never waits for the full walk, (3) keeping lane layout
incremental rather than O(n) per page, and (4) the disk cache making every *subsequent* open of an
unchanged repository an instant hydration instead of a re-walk. The `tests/integration/p0d-git-graph.test.ts`
spike already validated the parser/lane algorithm at 100,000 commits; M5's own
`tests/integration/m5-git-history.test.ts` additionally covers the disk-cache round trip and real
edge cases (shallow clones, replace refs, tags, detached HEAD) the synthetic spike fixture does not
naturally exercise.

## Consequences
- A repository whose `HEAD` moves while a background index is still in flight requires a full
  re-index rather than an incremental patch; acceptable for v1, revisit if profiling shows this is
  a real cost on large, frequently-updated repositories.
- The disk cache format has no version field. A future change to `CommitNode`'s shape must either
  stay backward-compatible or bump the cache file name/key so old entries are naturally ignored
  rather than deserialized incorrectly.
- Cache files are unbounded on disk (one per ever-opened repository, never evicted). Acceptable for
  v1 given JSON-per-repository sizes are small relative to typical available disk; a follow-up
  should add eviction if this proves not to be the case in practice.
