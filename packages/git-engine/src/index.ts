/**
 * @space/git-engine
 *
 * Structured Git commands (executable + argument array, never concatenated
 * shell strings), machine-readable output parsers, the history/graph lane
 * algorithm, and the per-repository operation queue (spec sections 11-12).
 * The system `git` executable is the single source of truth; no libgit2 or
 * second repository engine is introduced.
 *
 * History parser and lane layout seeded by the P0-D spike; completed in M5.
 * `diff/hunks.ts`'s hunk-level parser and `staging.ts`'s
 * `applyPatchToWorktree` added in M7 for the intent/agent layer (spec
 * section 13, 19.1's `file.modify`).
 */
export * from './history/types';
export * from './history/parser';
export * from './history/lanes';
export * from './history/cache';
export * from './history/fs-history-cache';
export * from './history/store';
export * from './clone';
export * from './node-git-executor';
export * from './commands';
export * from './status/types';
export * from './status/parser';
export * from './refs/types';
export * from './refs/parser';
export * from './diff/types';
export * from './diff/parser';
export * from './diff/hunks';
export * from './repository-state';
export * from './node-git-dir-fs';
export * from './repository';
export * from './init';
export * from './identity';
export * from './staging';
export * from './commit';
export * from './branches';
export * from './remote';
export * from './tag';
export * from './stash';
export * from './worktree';
export * from './conflicts';
export * from './queue';
export * from './watcher';
