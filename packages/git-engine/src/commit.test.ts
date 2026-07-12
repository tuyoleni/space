import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import { CommitFailedError, StaleIndexError, runCommit, verifyIntendedIndexState } from './commit';
import type { GitIdentity } from './identity';
import type { RepositoryStatus } from './status/types';

const identity: GitIdentity = { name: 'A', email: 'a@example.com', signingPolicy: 'none', signingKeyId: null };

function statusWithStaged(paths: readonly string[]): RepositoryStatus {
  return {
    branch: { headCommit: 'abc', isInitial: false, branchName: 'main', detached: false, upstream: null, ahead: null, behind: null },
    entries: paths.map((path) => ({
      kind: 'ordinary' as const,
      path,
      indexStatus: 'M' as const,
      worktreeStatus: '.' as const,
      headMode: '100644',
      indexMode: '100644',
      worktreeMode: '100644',
      submodule: { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false },
    })),
  };
}

describe('verifyIntendedIndexState', () => {
  it('passes silently when staged paths exactly match', () => {
    expect(() => verifyIntendedIndexState(statusWithStaged(['a.txt', 'b.txt']), ['a.txt', 'b.txt'])).not.toThrow();
  });

  it('throws StaleIndexError when a file was unstaged after the commit was prepared', () => {
    expect(() => verifyIntendedIndexState(statusWithStaged(['a.txt']), ['a.txt', 'b.txt'])).toThrowError(StaleIndexError);
  });

  it('throws StaleIndexError when a new file was staged after the commit was prepared', () => {
    try {
      verifyIntendedIndexState(statusWithStaged(['a.txt', 'c.txt']), ['a.txt']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StaleIndexError);
      expect((error as StaleIndexError).unexpected).toEqual(['c.txt']);
    }
  });
});

describe('runCommit', () => {
  it('injects identity via -c, sends the message over stdin, and verifies the resulting SHA', async () => {
    const executor: GitExecutor = vi.fn(async (args) => {
      if (args[0] === 'commit' || args.includes('commit')) {
        return { exitCode: 0, stdout: 'pre-commit hook: ok\n', stderr: '' };
      }
      return { exitCode: 0, stdout: 'deadbeef\n', stderr: '' };
    });

    const outcome = await runCommit('/repo', { identity, message: 'fix bug' }, executor);

    expect(outcome.sha).toBe('deadbeef');
    expect(outcome.hookOutput).toContain('pre-commit hook: ok');
    const commitCall = (executor as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(commitCall[0]).toEqual(
      expect.arrayContaining(['-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '-F', '-']),
    );
    expect(commitCall[1]).toMatchObject({ cwd: '/repo', input: 'fix bug' });
  });

  it('surfaces pre-commit hook failure output rather than a generic error', async () => {
    const executor: GitExecutor = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'husky - pre-commit hook exited with code 1 (error)\nlint failed on src/x.ts',
    }));
    await expect(runCommit('/repo', { identity, message: 'msg' }, executor)).rejects.toThrow(CommitFailedError);
    try {
      await runCommit('/repo', { identity, message: 'msg' }, executor);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommitFailedError);
      expect((error as CommitFailedError).hookOutput).toContain('lint failed on src/x.ts');
    }
  });

  it('throws if the commit exit code is 0 but the resulting SHA cannot be verified', async () => {
    const executor: GitExecutor = vi.fn(async (args) =>
      args.includes('commit') ? { exitCode: 0, stdout: '', stderr: '' } : { exitCode: 128, stdout: '', stderr: 'fatal' },
    );
    await expect(runCommit('/repo', { identity, message: 'msg' }, executor)).rejects.toThrow(/could not be verified/);
  });

  it('passes --no-verify only when explicitly requested (advanced action)', async () => {
    const executor: GitExecutor = vi.fn(async (args) =>
      args.includes('commit') ? { exitCode: 0, stdout: '', stderr: '' } : { exitCode: 0, stdout: 'sha1\n', stderr: '' },
    );
    await runCommit('/repo', { identity, message: 'msg', noVerify: true }, executor);
    const commitCall = (executor as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(commitCall[0]).toContain('--no-verify');
  });
});
