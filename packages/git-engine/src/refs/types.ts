/**
 * Ref model (spec section 11.3.2), produced by parsing
 * `git for-each-ref --format=<NUL-safe structured format>`.
 */

export type RefKind = 'local-branch' | 'remote-branch' | 'tag';

export interface RefEntry {
  readonly refname: string;
  readonly kind: RefKind;
  /** Short display name, e.g. "main" for refs/heads/main, "origin/main" for refs/remotes/origin/main. */
  readonly shortName: string;
  readonly sha: string;
  /** Set only for annotated tags: the SHA the tag object points at. */
  readonly peeledSha: string | null;
  readonly objectType: string;
  readonly isHead: boolean;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly upstreamGone: boolean;
  readonly subject: string;
}
