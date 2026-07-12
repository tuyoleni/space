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
export * from './repository-state';
export * from './node-git-dir-fs';
export * from './repository';
export * from './init';
export * from './identity';
export * from './staging';
export * from './commit';
export * from './branches';
export * from './remote';
export * from './conflicts';
export * from './queue';
export * from './watcher';
