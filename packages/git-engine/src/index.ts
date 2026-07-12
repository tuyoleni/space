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
