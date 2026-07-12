/**
 * HistoryStore (spec 12.5, ADR-007): wires the parser and lane algorithm
 * into a real, paginated, cached end-to-end path. `loadInitial` hydrates
 * from the disk cache when the repository's HEAD SHA still matches (spec
 * 12.5: "initial visible history should appear before full repository
 * indexing completes"), then indexes the remainder of the repository in
 * the background using repeated `git log --skip=/-n` pages. Because
 * `LaneLayout` carries its lane state across calls, feeding it pages in
 * order keeps lane assignments stable as more history loads (spec 12.4) —
 * this store never re-lays-out from scratch on every page.
 *
 * Pagination correctness assumption (recorded in ADR-007): `git log --all
 * --topo-order --date-order --parents` produces a deterministic total
 * order for a fixed ref/commit graph, so `--skip=N -n COUNT` pages are
 * stable and non-overlapping as long as no ref changes between calls. If
 * a ref *does* change mid-index (a fetch/pull lands while the store is
 * still indexing), the caller must call `invalidate()` — wired to the
 * repository watcher's "git-dir" hint — and reload from scratch. Space v1
 * does a full re-index on invalidation rather than an incremental delta:
 * simpler and always correct, at the cost of re-walking history on every
 * ref change rather than patching just the new commits.
 */
import { LaneLayout, type LaneRow } from './lanes';
import { historyLogArgs, parseHistoryOutput } from './parser';
import type { CommitNode } from './types';
import type { HistoryCachePort } from './cache';
import type { GitExecutor } from '../clone';

export interface HistoryPage {
  readonly commits: readonly CommitNode[];
  readonly rows: readonly LaneRow[];
  readonly totalIndexed: number;
  readonly fullyIndexed: boolean;
}

export interface HistoryStoreOptions {
  readonly cwd: string;
  /** Stable cache key for this repository, e.g. a hash of its canonical path. */
  readonly repoKey: string;
  readonly executor: GitExecutor;
  readonly cache?: HistoryCachePort;
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;

export class HistoryStore {
  private commits: CommitNode[] = [];
  private laneLayout = new LaneLayout();
  private rows: LaneRow[] = [];
  private fullyIndexed = false;
  /**
   * Every individual page fetch — whether requested by `loadInitial`'s
   * background indexing or by an on-demand `getPage` — is appended to this
   * single chain, so `skip` offsets are always computed from the true
   * current length rather than racing two concurrent fetches (spec 11.13:
   * reads that can't conflict may run concurrently, but pagination state
   * here can, so it stays serialized).
   */
  private indexingChain: Promise<void> = Promise.resolve();
  private readonly pageSize: number;

  constructor(private readonly options: HistoryStoreOptions) {
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  get indexedCount(): number {
    return this.commits.length;
  }

  get isFullyIndexed(): boolean {
    return this.fullyIndexed;
  }

  /** Resets in-memory state; caller must `loadInitial()` again (spec 11.12: a watcher hint never edits state directly). */
  invalidate(): void {
    this.commits = [];
    this.laneLayout = new LaneLayout();
    this.rows = [];
    this.fullyIndexed = false;
    this.indexingChain = Promise.resolve();
  }

  async loadInitial(visibleCount: number = this.pageSize): Promise<HistoryPage> {
    const headSha = await this.currentHeadSha();
    const cached = this.options.cache ? await this.options.cache.read(this.options.repoKey) : null;
    if (cached && headSha !== null && cached.headSha === headSha) {
      this.applyFullCommitList(cached.commits);
    } else {
      await this.ensureIndexedThrough(Math.max(visibleCount, this.pageSize));
      if (!this.fullyIndexed) {
        void this.indexRemaining();
      }
    }
    return this.page(0, visibleCount);
  }

  async getPage(offset: number, count: number): Promise<HistoryPage> {
    await this.ensureIndexedThrough(offset + count);
    return this.page(offset, count);
  }

  private page(offset: number, count: number): HistoryPage {
    return {
      commits: this.commits.slice(offset, offset + count),
      rows: this.rows.slice(offset, offset + count),
      totalIndexed: this.commits.length,
      fullyIndexed: this.fullyIndexed,
    };
  }

  private async currentHeadSha(): Promise<string | null> {
    const result = await this.options.executor(['rev-parse', 'HEAD'], { cwd: this.options.cwd });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  private applyFullCommitList(commits: readonly CommitNode[]): void {
    this.commits = [...commits];
    this.laneLayout = new LaneLayout();
    this.rows = this.laneLayout.layout(this.commits);
    this.fullyIndexed = true;
  }

  /** Enqueues fetching exactly the next page onto the shared indexing chain. */
  private fetchNextPageQueued(): Promise<void> {
    const next = this.indexingChain.then(() => this.fetchNextPage());
    this.indexingChain = next;
    return next;
  }

  private async ensureIndexedThrough(target: number): Promise<void> {
    while (this.commits.length < target && !this.fullyIndexed) {
      await this.fetchNextPageQueued();
    }
  }

  private async indexRemaining(): Promise<void> {
    while (!this.fullyIndexed) {
      await this.fetchNextPageQueued();
    }
  }

  private async fetchNextPage(): Promise<void> {
    if (this.fullyIndexed) {
      return;
    }
    const skip = this.commits.length;
    const args = historyLogArgs([`--skip=${skip}`, '-n', String(this.pageSize)]);
    const result = await this.options.executor(args, { cwd: this.options.cwd });
    if (result.exitCode !== 0) {
      throw new Error(`git log failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
    }
    const newCommits = parseHistoryOutput(result.stdout);
    this.commits.push(...newCommits);
    this.rows.push(...this.laneLayout.layout(newCommits));
    if (newCommits.length < this.pageSize) {
      this.fullyIndexed = true;
      await this.persistToCache();
    }
  }

  private async persistToCache(): Promise<void> {
    if (!this.options.cache) {
      return;
    }
    const headSha = await this.currentHeadSha();
    if (headSha !== null) {
      await this.options.cache.write(this.options.repoKey, { headSha, commits: this.commits });
    }
  }
}
