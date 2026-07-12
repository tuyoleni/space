import { describe, expect, it } from 'vitest';
import { parseHistoryOutput } from './parser';

const RS = '\x1e';
const FS = '\x1f';

function record(
  sha: string,
  parents: string,
  authorName: string,
  authorEmail: string,
  authoredAt: string,
  committedAt: string,
  decorated: string,
  subject: string,
  body = '',
): string {
  return RS + [sha, parents, authorName, authorEmail, authoredAt, committedAt, decorated, subject, body].join(FS);
}

describe('parseHistoryOutput', () => {
  it('parses a single linear commit with no parents', () => {
    const output = record('aaa111', '', 'Ada Lovelace', 'ada@example.com', '1600000000', '1600000001', '', 'initial commit');
    const [commit] = parseHistoryOutput(output);
    expect(commit).toMatchObject({
      sha: 'aaa111',
      parents: [],
      authorName: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      authoredAt: 1600000000000,
      committedAt: 1600000001000,
      subject: 'initial commit',
      refs: [],
    });
    expect(commit?.body).toBeUndefined();
  });

  it('parses a merge commit with multiple parents', () => {
    const output = record('mmm999', 'aaa111 bbb222', 'Merger', 'm@example.com', '1600000010', '1600000010', '', "Merge branch 'feature'");
    const [commit] = parseHistoryOutput(output);
    expect(commit?.parents).toEqual(['aaa111', 'bbb222']);
  });

  it('parses unicode author names, emoji, and CJK subjects', () => {
    const output = record('u1', '', '田中太郎', 'tanaka@example.co.jp', '1600000020', '1600000020', '', '修正: バグを直した 🎉');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.authorName).toBe('田中太郎');
    expect(commit?.subject).toBe('修正: バグを直した 🎉');
  });

  it('parses unusual author names with commas, apostrophes, and titles', () => {
    const output = record('u2', '', "O'Brien, Jr. (Dr.)", 'obrien@example.com', '1600000030', '1600000030', '', 'fix');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.authorName).toBe("O'Brien, Jr. (Dr.)");
  });

  it('parses a multi-line commit body separately from the subject', () => {
    const body = 'This explains why.\n\nSecond paragraph with detail.';
    const output = record('b1', '', 'Author', 'a@example.com', '1600000040', '1600000040', '', 'short subject', body);
    const [commit] = parseHistoryOutput(output);
    expect(commit?.subject).toBe('short subject');
    expect(commit?.body).toBe(body);
  });

  it('omits body entirely when the commit has no body', () => {
    const output = record('b2', '', 'Author', 'a@example.com', '1600000050', '1600000050', '', 'subject only', '');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.body).toBeUndefined();
  });

  it('parses local branch, remote branch, and tag decorations together', () => {
    const decorated = 'HEAD -> refs/heads/main, tag: refs/tags/v1.0.0, refs/remotes/origin/main, refs/heads/other';
    const output = record('d1', '', 'A', 'a@example.com', '1600000060', '1600000060', decorated, 'tagged release');
    const [commit] = parseHistoryOutput(output);
    const kinds = commit?.refs.map((r) => r.kind).sort();
    expect(kinds).toEqual(['HEAD', 'local-branch', 'local-branch', 'remote-branch', 'tag']);
    expect(commit?.refs.find((r) => r.kind === 'tag')?.name).toBe('v1.0.0');
  });

  it('parses a detached HEAD decoration without a branch name', () => {
    const output = record('e1', '', 'A', 'a@example.com', '1600000070', '1600000070', 'HEAD', 'detached commit');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.refs).toEqual([{ name: 'HEAD', kind: 'HEAD' }]);
  });

  it('parses a commit with no decoration at all', () => {
    const output = record('f1', '', 'A', 'a@example.com', '1600000080', '1600000080', '', 'plain');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.refs).toEqual([]);
  });

  it('parses multiple records separated by the record separator', () => {
    const output =
      record('a', '', 'A', 'a@example.com', '1', '1', '', 'first') +
      record('b', 'a', 'A', 'a@example.com', '2', '2', '', 'second');
    const commits = parseHistoryOutput(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.sha).toBe('a');
    expect(commits[1]?.parents).toEqual(['a']);
  });

  it('omits authorEmail when empty rather than including an empty string', () => {
    const output = record('g1', '', 'A', '', '1', '1', '', 'no email author');
    const [commit] = parseHistoryOutput(output);
    expect(commit?.authorEmail).toBeUndefined();
  });

  it('returns an empty array for empty output', () => {
    expect(parseHistoryOutput('')).toEqual([]);
  });
});
