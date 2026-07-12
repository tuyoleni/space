import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from '../clone';
import { createInMemoryHistoryCache } from './cache';
import { HistoryStore } from './store';

const RS = '\x1e';
const FS = '\x1f';
const HEAD_SHA = 'head0000';
const TOTAL_COMMITS = 25;

function formatCommit(index: number): string {
  const sha = `c${String(index).padStart(4, '0')}`;
  const parent = index + 1 < TOTAL_COMMITS ? `c${String(index + 1).padStart(4, '0')}` : '';
  return RS + ['x'.repeat(0) + sha, parent, 'Author', 'a@example.com', String(1600000000 + index), String(1600000000 + index), '', `commit ${index}`, ''].join(FS);
}

/** All commits newest-first, matching --topo-order --date-order for a linear history. */
const ALL_COMMITS = Array.from({ length: TOTAL_COMMITS }, (_, i) => i);

function makeFakeExecutor(): GitExecutor {
  return vi.fn(async (args: readonly string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { exitCode: 0, stdout: `${HEAD_SHA}\n`, stderr: '' };
    }
    const skipArg = args.find((a: string) => a.startsWith('--skip='));
    const skip = skipArg ? Number(skipArg.slice('--skip='.length)) : 0;
    const nIndex = args.indexOf('-n');
    const count = nIndex !== -1 ? Number(args[nIndex + 1]) : TOTAL_COMMITS;
    const slice = ALL_COMMITS.slice(skip, skip + count);
    return { exitCode: 0, stdout: slice.map(formatCommit).join(''), stderr: '' };
  });
}

describe('HistoryStore.loadInitial / getPage', () => {
  it('loads the first visible page without waiting for full indexing', async () => {
    const store = new HistoryStore({ cwd: '/repo', repoKey: 'repo-1', executor: makeFakeExecutor(), pageSize: 10 });
    const page = await store.loadInitial(5);
    expect(page.commits).toHaveLength(5);
    expect(page.commits[0]?.sha).toBe('c0000');
    expect(page.rows).toHaveLength(5);
  });

  it('eventually indexes the full repository in the background', async () => {
    const store = new HistoryStore({ cwd: '/repo', repoKey: 'repo-1', executor: makeFakeExecutor(), pageSize: 10 });
    await store.loadInitial(5);
    // Poll until background indexing completes.
    for (let i = 0; i < 50 && !store.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(store.isFullyIndexed).toBe(true);
    expect(store.indexedCount).toBe(TOTAL_COMMITS);
  });

  it('getPage fetches more commits on demand when the requested window extends past what is indexed', async () => {
    const store = new HistoryStore({ cwd: '/repo', repoKey: 'repo-1', executor: makeFakeExecutor(), pageSize: 5 });
    await store.loadInitial(5);
    const page = await store.getPage(20, 5);
    expect(page.commits).toHaveLength(5);
    expect(page.commits[0]?.sha).toBe('c0020');
    expect(page.totalIndexed).toBe(TOTAL_COMMITS);
    // `fullyIndexed` only flips once a fetch confirms no more commits remain
    // (a page shorter than pageSize); when the total is an exact multiple
    // of pageSize that confirmation is one more page away, delivered by the
    // background indexer this store kicked off — it is not required to
    // have landed synchronously with this on-demand getPage.
    for (let i = 0; i < 50 && !store.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(store.isFullyIndexed).toBe(true);
  });

  it('keeps lane assignments identical whether history loads as one page or many (spec 12.4)', async () => {
    const singlePageStore = new HistoryStore({ cwd: '/repo', repoKey: 'repo-single', executor: makeFakeExecutor(), pageSize: 1000 });
    const single = await singlePageStore.loadInitial(TOTAL_COMMITS);

    const pagedStore = new HistoryStore({ cwd: '/repo', repoKey: 'repo-paged', executor: makeFakeExecutor(), pageSize: 4 });
    await pagedStore.loadInitial(4);
    for (let i = 0; i < 50 && !pagedStore.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const paged = await pagedStore.getPage(0, TOTAL_COMMITS);

    expect(paged.rows).toEqual(single.rows);
  });
});

describe('HistoryStore cache hydration (ADR-007)', () => {
  it('hydrates instantly from the cache when the cached HEAD SHA still matches', async () => {
    const cache = createInMemoryHistoryCache();
    const executor = makeFakeExecutor();
    const warm = new HistoryStore({ cwd: '/repo', repoKey: 'repo-cache', executor, cache, pageSize: 10 });
    await warm.loadInitial(5);
    for (let i = 0; i < 50 && !warm.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const callsAfterFullIndex = (executor as ReturnType<typeof vi.fn>).mock.calls.length;

    const cold = new HistoryStore({ cwd: '/repo', repoKey: 'repo-cache', executor, cache, pageSize: 10 });
    const page = await cold.loadInitial(5);

    expect(page.totalIndexed).toBe(TOTAL_COMMITS);
    expect(cold.isFullyIndexed).toBe(true);
    // Only one extra call: the rev-parse HEAD check used to validate the cache.
    expect((executor as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFullIndex + 1);
  });

  it('falls back to a real git log when the cached HEAD SHA is stale', async () => {
    const cache = createInMemoryHistoryCache();
    await cache.write('repo-cache-2', { headSha: 'stale-sha', commits: [] });
    const store = new HistoryStore({ cwd: '/repo', repoKey: 'repo-cache-2', executor: makeFakeExecutor(), cache, pageSize: 10 });
    const page = await store.loadInitial(5);
    expect(page.commits[0]?.sha).toBe('c0000');
  });
});

describe('HistoryStore.invalidate', () => {
  it('resets state so a subsequent loadInitial re-reads from git', async () => {
    const store = new HistoryStore({ cwd: '/repo', repoKey: 'repo-invalidate', executor: makeFakeExecutor(), pageSize: 10 });
    await store.loadInitial(5);
    store.invalidate();
    expect(store.indexedCount).toBe(0);
    expect(store.isFullyIndexed).toBe(false);
    const page = await store.loadInitial(5);
    expect(page.commits).toHaveLength(5);
  });
});
