/**
 * Commit graph model (spec section 12.3). The renderer derives topology
 * from commit and parent SHAs; it never parses the ASCII art produced by
 * `git log --graph`.
 */

export interface RepositoryRef {
  readonly name: string;
  readonly kind: 'local-branch' | 'remote-branch' | 'tag' | 'HEAD';
}

export type SignatureState = 'good' | 'bad' | 'unknown' | 'unsigned';

export interface CommitNode {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly body?: string;
  readonly authorName: string;
  readonly authorEmail?: string;
  readonly authoredAt: number;
  readonly committedAt: number;
  readonly refs: readonly RepositoryRef[];
  readonly signature?: SignatureState;
}
