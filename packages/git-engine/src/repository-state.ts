/**
 * In-progress operation state (spec 11.4: "ongoing merge, rebase,
 * cherry-pick, revert, bisect, and sequencer states"). `git status` does
 * not report this on its own — it is derived from the presence of
 * well-known files inside the git directory (returned by
 * `git rev-parse --git-dir`, spec 11.3.1), never by parsing prose output.
 * The filesystem check is injected so this stays testable without a real
 * repository.
 */
import path from 'node:path';

export type RepositoryOperationState =
  | { readonly kind: 'none' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'rebase'; readonly interactive: boolean }
  | { readonly kind: 'am' }
  | { readonly kind: 'cherry-pick'; readonly sequencer: boolean }
  | { readonly kind: 'revert'; readonly sequencer: boolean }
  | { readonly kind: 'bisect' };

export interface GitDirFsPort {
  exists(path: string): Promise<boolean>;
}

/** Platform-aware join (spec 30.3: "never concatenate paths manually") — `gitDir` comes from `git rev-parse --git-dir`, a real filesystem path, not a display/URL string. */
function join(gitDir: string, ...segments: string[]): string {
  return path.join(gitDir, ...segments);
}

/**
 * Order matters: rebase-merge/rebase-apply are checked first because a
 * cherry-pick/revert sequence started via `rebase -i` can leave sequencer
 * markers behind too, and a genuine `git am` (not a rebase) also uses
 * rebase-apply without the `rebasing` marker file.
 */
export async function detectRepositoryOperationState(
  gitDir: string,
  fs: GitDirFsPort,
): Promise<RepositoryOperationState> {
  if (await fs.exists(join(gitDir, 'rebase-merge'))) {
    return { kind: 'rebase', interactive: await fs.exists(join(gitDir, 'rebase-merge', 'interactive')) };
  }
  if (await fs.exists(join(gitDir, 'rebase-apply'))) {
    if (await fs.exists(join(gitDir, 'rebase-apply', 'rebasing'))) {
      return { kind: 'rebase', interactive: false };
    }
    return { kind: 'am' };
  }
  if (await fs.exists(join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { kind: 'cherry-pick', sequencer: await fs.exists(join(gitDir, 'sequencer', 'todo')) };
  }
  if (await fs.exists(join(gitDir, 'REVERT_HEAD'))) {
    return { kind: 'revert', sequencer: await fs.exists(join(gitDir, 'sequencer', 'todo')) };
  }
  if (await fs.exists(join(gitDir, 'MERGE_HEAD'))) {
    return { kind: 'merge' };
  }
  if (await fs.exists(join(gitDir, 'BISECT_LOG'))) {
    return { kind: 'bisect' };
  }
  return { kind: 'none' };
}
