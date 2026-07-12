/**
 * Structured Git command builders (spec section 11.3). Every export here
 * returns an argument array only, never a concatenated string — callers
 * combine it with the resolved `git` executable path (spec 11.2, resolved
 * from the machine tool registry, not solely the renderer's inherited
 * PATH) and the injected `GitExecutor` (spec 21.3/25.3.2: `shell: false`,
 * arguments as an array, `--` separating flags from caller-supplied
 * values). This is the single place command shapes live so every caller in
 * this package uses the exact forms spec 11.3.1-11.3.4 requires.
 */

// ---------------------------------------------------------------------------
// 11.3.1: repository root and state
// ---------------------------------------------------------------------------

export function repositoryRootArgs(): string[] {
  return ['rev-parse', '--show-toplevel'];
}

export function gitDirArgs(): string[] {
  return ['rev-parse', '--git-dir'];
}

export function isInsideWorkTreeArgs(): string[] {
  return ['rev-parse', '--is-inside-work-tree'];
}

export function statusArgs(): string[] {
  return ['status', '--porcelain=v2', '-z', '--branch'];
}

// ---------------------------------------------------------------------------
// 11.3.2: refs
// ---------------------------------------------------------------------------

/** Field separator used inside one for-each-ref record; refs cannot contain it. */
export const REF_FIELD_SEPARATOR = '\x1f';
/**
 * Record separator between for-each-ref entries. Unlike `status`/`diff`,
 * `for-each-ref` has no `-z`/NUL-terminated output mode, so the separator
 * has to be a literal character embedded in the `--format` argument itself
 * — and a process argument can never contain an actual NUL byte (the OS
 * rejects it), so this must be a different control character than status/
 * diff's NUL, not \x00.
 */
export const REF_RECORD_SEPARATOR = '\x1e';

const REF_FORMAT_FIELDS = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(objecttype)',
  '%(HEAD)',
  '%(upstream)',
  '%(upstream:track)',
  '%(subject)',
] as const;

export const REF_FORMAT = REF_FORMAT_FIELDS.join(REF_FIELD_SEPARATOR) + REF_RECORD_SEPARATOR;

export function forEachRefArgs(
  patterns: readonly string[] = ['refs/heads', 'refs/remotes', 'refs/tags'],
): string[] {
  return ['for-each-ref', `--format=${REF_FORMAT}`, ...patterns];
}

// ---------------------------------------------------------------------------
// 11.3.4: diffs
// ---------------------------------------------------------------------------

export interface DiffCommandOptions {
  readonly cached?: boolean;
  readonly paths?: readonly string[];
}

function pathScope(paths?: readonly string[]): string[] {
  return paths && paths.length > 0 ? ['--', ...paths] : [];
}

/** `git diff --raw -z` (optionally `--cached`): machine-readable per-file status, NUL-safe. */
export function diffRawArgs(options: DiffCommandOptions = {}): string[] {
  return ['diff', '--no-ext-diff', ...(options.cached ? ['--cached'] : []), '--raw', '-z', ...pathScope(options.paths)];
}

/** `git diff --numstat -z` (optionally `--cached`): per-file added/removed line counts. */
export function diffNumstatArgs(options: DiffCommandOptions = {}): string[] {
  return [
    'diff',
    '--no-ext-diff',
    ...(options.cached ? ['--cached'] : []),
    '--numstat',
    '-z',
    ...pathScope(options.paths),
  ];
}

/**
 * Full unified patch text for a diff selection (patch-on-demand, spec
 * 12.6). `--binary` preserves round-trippable binary hunks. External diff
 * tools and textconv are never invoked (spec 11.3.4, 25.3): no `--ext-diff`,
 * no config-driven driver.
 */
export function diffPatchArgs(options: DiffCommandOptions = {}): string[] {
  return ['diff', '--no-ext-diff', '--binary', ...(options.cached ? ['--cached'] : []), ...pathScope(options.paths)];
}

// ---------------------------------------------------------------------------
// GIT-002/GIT-003: init and identity
// ---------------------------------------------------------------------------

export function initArgs(defaultBranch: string): string[] {
  return ['init', `--initial-branch=${defaultBranch}`];
}

export function configGetArgs(key: string, scope: 'local' | 'global' = 'local'): string[] {
  return ['config', `--${scope}`, '--get', key];
}

// ---------------------------------------------------------------------------
// GIT-004/GIT-005: staging and commit
// ---------------------------------------------------------------------------

export function addPathsArgs(paths: readonly string[]): string[] {
  return ['add', '--', ...paths];
}

export function resetPathsArgs(paths: readonly string[]): string[] {
  return ['restore', '--staged', '--', ...paths];
}

/** Applies a generated patch file to the index (hunk/line staging never shell-escapes a diff). */
export function applyPatchArgs(options: { readonly cached?: boolean; readonly reverse?: boolean } = {}): string[] {
  return ['apply', ...(options.cached ? ['--cached'] : []), ...(options.reverse ? ['--reverse'] : []), '-'];
}

export function checkoutPathsArgs(paths: readonly string[]): string[] {
  return ['checkout', '--', ...paths];
}

export function cleanUntrackedArgs(paths: readonly string[]): string[] {
  return ['clean', '-f', '--', ...paths];
}

export interface CommitArgsOptions {
  readonly amend?: boolean;
  readonly noVerify?: boolean;
  readonly allowEmpty?: boolean;
}

/** Commit message always flows through stdin (`-F -`), never a shell-escaped `-m` string. */
export function commitArgs(options: CommitArgsOptions = {}): string[] {
  return [
    'commit',
    ...(options.amend ? ['--amend'] : []),
    ...(options.noVerify ? ['--no-verify'] : []),
    ...(options.allowEmpty ? ['--allow-empty'] : []),
    '-F',
    '-',
  ];
}

// ---------------------------------------------------------------------------
// GIT-006: branches
// ---------------------------------------------------------------------------

export function createBranchArgs(name: string, fromCommit?: string): string[] {
  return fromCommit ? ['branch', '--', name, fromCommit] : ['branch', '--', name];
}

export function switchBranchArgs(name: string): string[] {
  return ['switch', '--', name];
}

export function renameBranchArgs(oldName: string, newName: string): string[] {
  return ['branch', '--move', '--', oldName, newName];
}

export function deleteBranchArgs(name: string, force: boolean): string[] {
  return ['branch', force ? '-D' : '-d', '--', name];
}

export function branchIsMergedArgs(name: string, targetRef: string): string[] {
  return ['branch', '--list', '--merged', targetRef, '--', name];
}

export function setUpstreamArgs(remoteName: string, branch: string): string[] {
  return ['branch', `--set-upstream-to=${remoteName}/${branch}`, branch];
}

// ---------------------------------------------------------------------------
// GIT-007: fetch, pull, push
// ---------------------------------------------------------------------------

export function fetchArgs(remoteName = 'origin'): string[] {
  return ['fetch', '--prune', '--', remoteName];
}

export type PullMode = 'merge' | 'rebase';

export function pullArgs(mode: PullMode, remoteName = 'origin', branch?: string): string[] {
  const base = ['pull', mode === 'rebase' ? '--rebase' : '--no-rebase', '--', remoteName];
  return branch ? [...base, branch] : base;
}

export interface PushArgsOptions {
  readonly remoteName?: string;
  readonly branch: string;
  readonly setUpstream?: boolean;
  /** `force-with-lease` is the only allowed force mode by default (spec 11.10). */
  readonly force?: 'none' | 'with-lease' | 'raw';
}

export function pushArgs(options: PushArgsOptions): string[] {
  const remoteName = options.remoteName ?? 'origin';
  const forceFlag = options.force === 'raw' ? ['--force'] : options.force === 'with-lease' ? ['--force-with-lease'] : [];
  return ['push', ...(options.setUpstream ? ['--set-upstream'] : []), ...forceFlag, '--', remoteName, options.branch];
}

// ---------------------------------------------------------------------------
// GIT-008: conflicts / continue / abort
// ---------------------------------------------------------------------------

export function mergeContinueArgs(): string[] {
  return ['merge', '--continue'];
}
export function mergeAbortArgs(): string[] {
  return ['merge', '--abort'];
}
export function rebaseContinueArgs(): string[] {
  return ['rebase', '--continue'];
}
export function rebaseAbortArgs(): string[] {
  return ['rebase', '--abort'];
}
export function cherryPickContinueArgs(): string[] {
  return ['cherry-pick', '--continue'];
}
export function cherryPickAbortArgs(): string[] {
  return ['cherry-pick', '--abort'];
}
export function revertContinueArgs(): string[] {
  return ['revert', '--continue'];
}
export function revertAbortArgs(): string[] {
  return ['revert', '--abort'];
}
