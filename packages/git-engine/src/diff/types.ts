/**
 * Diff model (spec sections 11.3.4, 12.6 "changed files and statistics").
 * Produced by parsing `git diff --raw -z` and `git diff --numstat -z` —
 * never by parsing colored/human diff output.
 */

export type DiffStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface DiffRawEntry {
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldSha: string;
  readonly newSha: string;
  readonly statusCode: DiffStatusCode;
  /** Similarity percentage for R/C entries; null otherwise. */
  readonly similarityScore: number | null;
  readonly path: string;
  /** Set only for renamed/copied entries. */
  readonly oldPath: string | null;
}

export interface DiffNumstatEntry {
  /** null when the file is binary (git reports "-"). */
  readonly added: number | null;
  readonly removed: number | null;
  readonly path: string;
  readonly oldPath: string | null;
}
