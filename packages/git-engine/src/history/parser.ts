/**
 * History parser (spec section 11.3.3): consumes `git log` output produced
 * with explicit record (\x1e) and field (\x1f) separators that cannot
 * collide with normal text. Pure function over a string - covered by
 * fixtures including Unicode, newlines, unusual author names, merge
 * commits, tags, and detached HEAD (see parser.test.ts); shallow clones,
 * replace refs, and large histories are covered against a real git
 * executable in tests/integration.
 *
 * Expected git invocation (constructed as executable + argument array):
 *   git log --all --topo-order --date-order --parents --decorate=full
 *     --format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%D%x1f%s%x1f%b
 */
import type { CommitNode, RepositoryRef } from './types';

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

export const HISTORY_LOG_FORMAT =
  '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%D%x1f%s%x1f%b';

export function historyLogArgs(extra: readonly string[] = []): string[] {
  return [
    'log',
    '--all',
    '--topo-order',
    '--date-order',
    '--parents',
    '--decorate=full',
    `--format=${HISTORY_LOG_FORMAT}`,
    ...extra,
  ];
}

function parseRefs(decorated: string): RepositoryRef[] {
  if (decorated.trim().length === 0) {
    return [];
  }
  const refs: RepositoryRef[] = [];
  for (const rawEntry of decorated.split(',')) {
    const entry = rawEntry.trim();
    if (entry.length === 0) {
      continue;
    }
    if (entry === 'HEAD' || entry.startsWith('HEAD ->') || entry.endsWith('/HEAD')) {
      refs.push({ name: entry.replace('HEAD -> ', ''), kind: 'HEAD' });
      const target = entry.startsWith('HEAD -> ') ? entry.slice('HEAD -> '.length) : undefined;
      if (target?.startsWith('refs/heads/')) {
        refs.push({ name: target.slice('refs/heads/'.length), kind: 'local-branch' });
      }
      continue;
    }
    if (entry.startsWith('tag: refs/tags/')) {
      refs.push({ name: entry.slice('tag: refs/tags/'.length), kind: 'tag' });
    } else if (entry.startsWith('refs/heads/')) {
      refs.push({ name: entry.slice('refs/heads/'.length), kind: 'local-branch' });
    } else if (entry.startsWith('refs/remotes/')) {
      refs.push({ name: entry.slice('refs/remotes/'.length), kind: 'remote-branch' });
    }
  }
  return refs;
}

export function parseHistoryOutput(output: string): CommitNode[] {
  const commits: CommitNode[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n+/, '');
    if (trimmed.length === 0) {
      continue;
    }
    const fields = trimmed.split(FIELD_SEPARATOR);
    if (fields.length < 9) {
      continue;
    }
    const [sha, parentsRaw, authorName, authorEmail, authoredAt, committedAt, decorated, subject, ...bodyParts] =
      fields as [string, string, string, string, string, string, string, string, ...string[]];
    // %b (body) cannot itself contain \x1e/\x1f in ordinary commit
    // messages, but a plain rejoin keeps this lossless defensively, same
    // as the subject field used to be handled before it became fixed-width.
    const body = bodyParts.join(FIELD_SEPARATOR).replace(/^\n/, '').replace(/\n+$/, '');
    commits.push({
      sha: sha.trim(),
      parents: parentsRaw.trim().length === 0 ? [] : parentsRaw.trim().split(/\s+/),
      authorName,
      ...(authorEmail.length > 0 ? { authorEmail } : {}),
      authoredAt: Number(authoredAt) * 1000,
      committedAt: Number(committedAt) * 1000,
      refs: parseRefs(decorated),
      subject: subject.replace(/\n+$/, ''),
      ...(body.length > 0 ? { body } : {}),
    });
  }
  return commits;
}
