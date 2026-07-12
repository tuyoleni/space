/**
 * Status model (spec section 11.4, GIT-001). Produced by parsing
 * `git status --porcelain=v2 -z --branch` (spec 11.3.1) — never by parsing
 * colored/human `git status` output (spec section 39).
 */

/** `.` means "no change" for that side (index or worktree). */
export type FileStatusCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T';

export interface SubmoduleState {
  readonly isSubmodule: boolean;
  readonly commitChanged: boolean;
  readonly hasModifiedContent: boolean;
  readonly hasUntrackedContent: boolean;
}

export interface OrdinaryStatusEntry {
  readonly kind: 'ordinary';
  readonly path: string;
  readonly indexStatus: FileStatusCode;
  readonly worktreeStatus: FileStatusCode;
  readonly headMode: string;
  readonly indexMode: string;
  readonly worktreeMode: string;
  readonly submodule: SubmoduleState;
}

export interface RenamedOrCopiedStatusEntry {
  readonly kind: 'renamed-or-copied';
  readonly path: string;
  readonly originalPath: string;
  readonly indexStatus: FileStatusCode;
  readonly worktreeStatus: FileStatusCode;
  /** 'R' or 'C' plus a similarity percentage, e.g. "R100". */
  readonly renameOrCopy: 'R' | 'C';
  readonly similarityScore: number;
  readonly submodule: SubmoduleState;
}

export interface UnmergedStatusEntry {
  readonly kind: 'unmerged';
  readonly path: string;
  /** Two-letter conflict code, e.g. "UU", "AA", "DD" (spec 11.4: unmerged entries). */
  readonly conflictCode: string;
  readonly submodule: SubmoduleState;
}

export interface UntrackedStatusEntry {
  readonly kind: 'untracked';
  readonly path: string;
}

export interface IgnoredStatusEntry {
  readonly kind: 'ignored';
  readonly path: string;
}

export type StatusEntry =
  | OrdinaryStatusEntry
  | RenamedOrCopiedStatusEntry
  | UnmergedStatusEntry
  | UntrackedStatusEntry
  | IgnoredStatusEntry;

export interface BranchInfo {
  /** null only for a brand-new repository with no commits yet (spec 11.4: "initial repository with no commits"). */
  readonly headCommit: string | null;
  readonly isInitial: boolean;
  /** null when HEAD is detached. */
  readonly branchName: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
}

export interface RepositoryStatus {
  readonly branch: BranchInfo;
  readonly entries: readonly StatusEntry[];
}
