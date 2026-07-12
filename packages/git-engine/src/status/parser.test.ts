import { describe, expect, it } from 'vitest';
import { parseStatusOutput } from './parser';

const NUL = '\x00';

function record(...fields: string[]): string {
  return fields.join(NUL) + NUL;
}

describe('parseStatusOutput', () => {
  it('parses the initial-repository-with-no-commits case (GIT-001)', () => {
    // Byte-for-byte shape captured from a real `git status --porcelain=v2 -z --branch`.
    const output = record('# branch.oid (initial)', '# branch.head main', '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 ce013625030ba8dba906f756967f9e9ca394464a a.txt') + record('? sub/');

    const status = parseStatusOutput(output);
    expect(status.branch.isInitial).toBe(true);
    expect(status.branch.headCommit).toBeNull();
    expect(status.branch.branchName).toBe('main');
    expect(status.branch.detached).toBe(false);
    expect(status.entries).toHaveLength(2);
    expect(status.entries[0]).toMatchObject({ kind: 'ordinary', path: 'a.txt', indexStatus: 'A', worktreeStatus: '.' });
    expect(status.entries[1]).toEqual({ kind: 'untracked', path: 'sub/' });
  });

  it('parses branch upstream and ahead/behind counts', () => {
    const output =
      record('# branch.oid abc123') +
      record('# branch.head main') +
      record('# branch.upstream origin/main') +
      record('# branch.ab +2 -3');
    const status = parseStatusOutput(output);
    expect(status.branch.headCommit).toBe('abc123');
    expect(status.branch.upstream).toBe('origin/main');
    expect(status.branch.ahead).toBe(2);
    expect(status.branch.behind).toBe(3);
  });

  it('parses a detached HEAD', () => {
    const output = record('# branch.oid abc123') + record('# branch.head (detached)');
    const status = parseStatusOutput(output);
    expect(status.branch.detached).toBe(true);
    expect(status.branch.branchName).toBeNull();
  });

  it('parses a renamed entry with two NUL-separated paths (real byte shape)', () => {
    const output =
      record('# branch.oid 052a2f972e6c96be25582d5fd5d1e8dd5a27dd8c') +
      record('# branch.head main') +
      '2 RM N... 100644 100644 100644 ce013625030ba8dba906f756967f9e9ca394464a ce013625030ba8dba906f756967f9e9ca394464a R100 c.txt' +
      NUL +
      'a.txt' +
      NUL +
      record('? sub/');

    const status = parseStatusOutput(output);
    const renamed = status.entries.find((e) => e.kind === 'renamed-or-copied');
    expect(renamed).toEqual({
      kind: 'renamed-or-copied',
      path: 'c.txt',
      originalPath: 'a.txt',
      indexStatus: 'R',
      worktreeStatus: 'M',
      renameOrCopy: 'R',
      similarityScore: 100,
      submodule: { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false },
    });
  });

  it('parses an unmerged (conflict) entry', () => {
    const output =
      record('# branch.oid abc') +
      record('# branch.head main') +
      record(
        'u UU N... 100644 100644 100644 100644 111111111111111111111111111111 22222222222222222222222222222222222222 3333333333333333333333333333333333333333 both.txt',
      );
    const status = parseStatusOutput(output);
    expect(status.entries[0]).toEqual({
      kind: 'unmerged',
      path: 'both.txt',
      conflictCode: 'UU',
      submodule: { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false },
    });
  });

  it('parses ignored files distinctly from untracked files', () => {
    const output = record('# branch.oid abc') + record('# branch.head main') + record('! node_modules/');
    const status = parseStatusOutput(output);
    expect(status.entries[0]).toEqual({ kind: 'ignored', path: 'node_modules/' });
  });

  it('parses a modified submodule entry', () => {
    const output =
      record('# branch.oid abc') +
      record('# branch.head main') +
      record('1 .M S.M. 160000 160000 160000 1111111111111111111111111111111111111 1111111111111111111111111111111111111 vendor/lib');
    const status = parseStatusOutput(output);
    expect(status.entries[0]).toMatchObject({
      kind: 'ordinary',
      path: 'vendor/lib',
      submodule: { isSubmodule: true, commitChanged: false, hasModifiedContent: true, hasUntrackedContent: false },
    });
  });

  it('parses paths containing spaces without truncating them', () => {
    const output = record('# branch.oid abc') + record('# branch.head main') + record('? file with spaces.txt');
    const status = parseStatusOutput(output);
    expect(status.entries[0]).toEqual({ kind: 'untracked', path: 'file with spaces.txt' });
  });

  it('returns an empty entry list for a clean repository', () => {
    const output = record('# branch.oid abc') + record('# branch.head main');
    const status = parseStatusOutput(output);
    expect(status.entries).toEqual([]);
  });
});
