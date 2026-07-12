/**
 * GIT-009: repository watcher (spec 11.12). Watches worktree paths (with
 * ignore rules for large generated directories) and the specific git-dir
 * paths that indicate a state change worth reacting to — `.git/HEAD`,
 * `.git/index`, `.git/refs`, `.git/packed-refs`, and the operation-state
 * files spec 11.4/11.12 lists (MERGE_HEAD, rebase-merge/apply,
 * CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG, sequencer). Every event is
 * debounced and passed to the caller only as a *hint* to refresh — this
 * module never claims to describe repository state itself; `git status`
 * (spec 11.4) stays authoritative. The underlying filesystem watch
 * primitive is injected so this is testable without touching a real
 * directory, and so the desktop wiring can supply `fs.watch` with
 * `recursive: true` (supported on the two platforms Space targets, spec
 * 1.1) without this module depending on Node directly.
 */

export interface WatchHandle {
  close(): void;
}

export type WatchFn = (
  path: string,
  options: { readonly recursive: boolean },
  listener: (eventType: string, filename: string | null) => void,
) => WatchHandle;

export interface RepositoryWatcherDeps {
  readonly watch: WatchFn;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export const DEFAULT_IGNORED_DIRECTORY_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  '.cache',
];

const RELEVANT_GIT_DIR_TOP_LEVEL_NAMES: readonly string[] = [
  'HEAD',
  'index',
  'packed-refs',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
];
const RELEVANT_GIT_DIR_PREFIXES: readonly string[] = ['refs/', 'rebase-merge', 'rebase-apply', 'sequencer/'];

export interface StartRepositoryWatcherOptions {
  readonly worktreeRoot: string;
  readonly gitDir: string;
  readonly debounceMs?: number;
  readonly ignoredDirectoryNames?: readonly string[];
  /** Called with a debounced hint after relevant filesystem activity — never a full state description. */
  readonly onChangeHint: (reason: 'worktree' | 'git-dir') => void;
}

function isIgnoredPath(relativePath: string, ignoredDirectoryNames: readonly string[]): boolean {
  const segments = relativePath.split(/[\\/]/);
  return segments.some((segment) => ignoredDirectoryNames.includes(segment));
}

function isRelevantGitDirPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return (
    RELEVANT_GIT_DIR_TOP_LEVEL_NAMES.includes(normalized) ||
    RELEVANT_GIT_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function startRepositoryWatcher(
  options: StartRepositoryWatcherOptions,
  deps: RepositoryWatcherDeps,
): WatchHandle {
  const ignoredDirectoryNames = options.ignoredDirectoryNames ?? DEFAULT_IGNORED_DIRECTORY_NAMES;
  const debounceMs = options.debounceMs ?? 300;
  let timer: unknown = null;
  let pendingReason: 'worktree' | 'git-dir' = 'worktree';

  const scheduleHint = (reason: 'worktree' | 'git-dir') => {
    // git-dir changes are the higher-signal reason; don't let a coalesced
    // worktree event mask a pending ref/HEAD change within the same window.
    if (pendingReason !== 'git-dir') {
      pendingReason = reason;
    }
    if (timer !== null) {
      deps.clearTimeout(timer);
    }
    timer = deps.setTimeout(() => {
      timer = null;
      const reasonToReport = pendingReason;
      pendingReason = 'worktree';
      options.onChangeHint(reasonToReport);
    }, debounceMs);
  };

  const worktreeWatcher = deps.watch(options.worktreeRoot, { recursive: true }, (_eventType, filename) => {
    if (filename !== null && isIgnoredPath(filename, ignoredDirectoryNames)) {
      return;
    }
    scheduleHint('worktree');
  });

  const gitDirWatcher = deps.watch(options.gitDir, { recursive: true }, (_eventType, filename) => {
    if (filename === null || isRelevantGitDirPath(filename)) {
      scheduleHint('git-dir');
    }
  });

  return {
    close: () => {
      if (timer !== null) {
        deps.clearTimeout(timer);
        timer = null;
      }
      worktreeWatcher.close();
      gitDirWatcher.close();
    },
  };
}
