import { describe, expect, it } from 'vitest';
import { BoundedGithubCache } from './cache';

describe('BoundedGithubCache (spec 27.4: GitHub cache size)', () => {
  it('stores and retrieves an entry with its last-refresh time', () => {
    const cache = new BoundedGithubCache<string>(10);
    cache.set('pr:1', 'pr-data', '2026-07-13T00:00:00.000Z');
    expect(cache.get('pr:1')).toEqual({ data: 'pr-data', lastRefreshedAt: '2026-07-13T00:00:00.000Z' });
  });

  it('never grows past maxEntries — the oldest untouched entry is evicted first', () => {
    const cache = new BoundedGithubCache<number>(3);
    cache.set('a', 1, 't1');
    cache.set('b', 2, 't2');
    cache.set('c', 3, 't3');
    expect(cache.size).toBe(3);

    cache.set('d', 4, 't4');
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeNull(); // evicted — least recently touched
    expect(cache.get('b')?.data).toBe(2);
    expect(cache.get('c')?.data).toBe(3);
    expect(cache.get('d')?.data).toBe(4);
  });

  it('a read refreshes recency, protecting a hot entry from eviction', () => {
    const cache = new BoundedGithubCache<number>(2);
    cache.set('a', 1, 't1');
    cache.set('b', 2, 't2');
    cache.get('a'); // touch 'a' — 'b' is now the least recently used
    cache.set('c', 3, 't3');

    expect(cache.get('a')?.data).toBe(1);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')?.data).toBe(3);
  });

  it('rejects a non-positive size bound', () => {
    expect(() => new BoundedGithubCache(0)).toThrow();
  });
});
