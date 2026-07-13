import { describe, expect, it } from 'vitest';
import { enforceDownloadCacheLimit, planEviction, type DownloadCacheFs, type DownloadCacheEntryStat } from './download-cache';

describe('planEviction (spec 27.4: install/download cache)', () => {
  it('removes nothing when under the limit', () => {
    const entries: DownloadCacheEntryStat[] = [{ name: 'a', sizeBytes: 100, touchedAtMs: 1 }];
    expect(planEviction(entries, 1000)).toEqual({ toRemove: [], bytesFreed: 0, remainingBytes: 100 });
  });

  it('evicts the least-recently-touched entries first, stopping as soon as it is under the limit', () => {
    const entries: DownloadCacheEntryStat[] = [
      { name: 'oldest', sizeBytes: 40, touchedAtMs: 1 },
      { name: 'middle', sizeBytes: 40, touchedAtMs: 2 },
      { name: 'newest', sizeBytes: 40, touchedAtMs: 3 },
    ];
    const plan = planEviction(entries, 50);
    expect(plan.toRemove).toEqual(['oldest', 'middle']);
    expect(plan.remainingBytes).toBe(40);
  });

  it('never removes more than needed to satisfy the limit', () => {
    const entries: DownloadCacheEntryStat[] = [
      { name: 'a', sizeBytes: 10, touchedAtMs: 1 },
      { name: 'b', sizeBytes: 10, touchedAtMs: 2 },
    ];
    const plan = planEviction(entries, 15);
    expect(plan.toRemove).toEqual(['a']);
    expect(plan.remainingBytes).toBe(10);
  });
});

describe('enforceDownloadCacheLimit', () => {
  it('removes the planned entries via the injected filesystem port', () => {
    const removed: string[] = [];
    const fs: DownloadCacheFs = {
      listEntries: () => [
        { name: 'oldest', sizeBytes: 300 * 1024 * 1024, touchedAtMs: 1 },
        { name: 'newest', sizeBytes: 300 * 1024 * 1024, touchedAtMs: 2 },
      ],
      remove: (_dir, name) => removed.push(name),
    };
    const plan = enforceDownloadCacheLimit(fs, '/cache', 512 * 1024 * 1024);
    expect(plan.toRemove).toEqual(['oldest']);
    expect(removed).toEqual(['oldest']);
  });

  it('touches nothing when the real filesystem never reports any entries', () => {
    const fs: DownloadCacheFs = { listEntries: () => [], remove: () => { throw new Error('should not be called'); } };
    expect(enforceDownloadCacheLimit(fs, '/cache').toRemove).toEqual([]);
  });
});
