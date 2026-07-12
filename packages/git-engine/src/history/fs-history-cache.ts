/**
 * Real (non-fake) disk-backed `HistoryCachePort`, one JSON file per
 * repository under the workspace's `cache/` directory (spec 9.2's
 * suggested `SpaceData/workspaces/<id>/cache/` layout). Mirrors
 * `node-git-executor.ts`: the only file in this module that actually
 * touches the filesystem — `HistoryStore` and every test depend on the
 * `HistoryCachePort` interface, never on this implementation directly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HistoryCacheEntry, HistoryCachePort } from './cache';

export function createFsHistoryCache(cacheDir: string): HistoryCachePort {
  const fileFor = (repoKey: string) => path.join(cacheDir, `${repoKey}.history.json`);
  return {
    read: async (repoKey) => {
      try {
        const raw = await fs.readFile(fileFor(repoKey), 'utf-8');
        return JSON.parse(raw) as HistoryCacheEntry;
      } catch {
        // Missing, unreadable, or corrupt cache is never fatal — it just
        // means the caller falls back to a real `git log`.
        return null;
      }
    },
    write: async (repoKey, entry) => {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(fileFor(repoKey), JSON.stringify(entry), 'utf-8');
    },
  };
}
