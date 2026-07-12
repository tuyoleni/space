/**
 * Real (non-fake) `GitDirFsPort` backed by `node:fs`, mirroring
 * `node-git-executor.ts`'s convention: production wiring for a capability
 * lives in one small file so `repository-state.ts` and its callers
 * (`repository.ts`, `conflicts.ts`) stay test-only DI.
 */
import fs from 'node:fs';
import type { GitDirFsPort } from './repository-state';

export function createNodeGitDirFs(): GitDirFsPort {
  return { exists: async (path) => fs.existsSync(path) };
}
