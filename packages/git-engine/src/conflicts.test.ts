import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import type { GitDirFsPort } from './repository-state';
import { abortOperation, continueOperation, deriveConflictState } from './conflicts';
import type { RepositoryStatus } from './status/types';

function statusWithUnmerged(paths: readonly string[]): RepositoryStatus {
  return {
    branch: { headCommit: 'abc', isInitial: false, branchName: 'main', detached: false, upstream: null, ahead: null, behind: null },
    entries: paths.map((path) => ({
      kind: 'unmerged' as const,
      path,
      conflictCode: 'UU',
      submodule: { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false },
    })),
  };
}

describe('deriveConflictState', () => {
  it('reports no conflict for a clean status', () => {
    const status = statusWithUnmerged([]);
    const state = deriveConflictState(status, { kind: 'none' });
    expect(state).toEqual({ inConflict: false, operation: { kind: 'none' }, conflictedFiles: [] });
  });

  it('reports conflicted files from unmerged status entries', () => {
    const status = statusWithUnmerged(['a.txt', 'b.txt']);
    const state = deriveConflictState(status, { kind: 'merge' });
    expect(state.inConflict).toBe(true);
    expect(state.conflictedFiles).toEqual(['a.txt', 'b.txt']);
  });
});

describe('continueOperation', () => {
  it('runs merge --continue and confirms completion by re-checking git-dir state, not exit code alone', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: 'merged', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async () => false }; // no MERGE_HEAD left -> completed
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'merge' }, executor, gitDirFs);
    expect(executor).toHaveBeenCalledWith(['merge', '--continue'], { cwd: '/repo' });
    expect(outcome.completed).toBe(true);
  });

  it('does not report completion when exit code is 0 but conflict markers remain (e.g. multi-step cherry-pick)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async (p) => p === '/repo/.git/CHERRY_PICK_HEAD' };
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'cherry-pick', sequencer: false }, executor, gitDirFs);
    expect(outcome.completed).toBe(false);
    expect(outcome.remaining.kind).toBe('cherry-pick');
  });

  it('does not report completion when the continue command itself failed (more conflicts remain)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'error: could not apply' }));
    const gitDirFs: GitDirFsPort = { exists: async (p) => p === '/repo/.git/rebase-merge' };
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'rebase', interactive: false }, executor, gitDirFs);
    expect(outcome.completed).toBe(false);
  });

  it('throws when no continuable operation is in progress', async () => {
    const executor: GitExecutor = vi.fn();
    const gitDirFs: GitDirFsPort = { exists: async () => false };
    await expect(continueOperation('/repo', '/repo/.git', { kind: 'none' }, executor, gitDirFs)).rejects.toThrow(/No continuable/);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('abortOperation', () => {
  it('runs rebase --abort and confirms via git-dir state', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async () => false };
    const outcome = await abortOperation('/repo', '/repo/.git', { kind: 'rebase', interactive: true }, executor, gitDirFs);
    expect(executor).toHaveBeenCalledWith(['rebase', '--abort'], { cwd: '/repo' });
    expect(outcome.completed).toBe(true);
  });
});
