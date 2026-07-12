import { describe, expect, it, vi } from 'vitest';
import { DestructiveGitActionNotConfirmedError } from '@space/domain';
import type { GitExecutor } from './clone';
import {
  compareBranches,
  createBranch,
  deleteBranch,
  isBranchMerged,
  renameBranch,
  setUpstream,
  switchBranch,
} from './branches';

describe('createBranch / switchBranch / renameBranch', () => {
  it('creates a branch from a specific commit', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await createBranch('/repo', 'feature', 'abc123', executor);
    expect(executor).toHaveBeenCalledWith(['branch', '--', 'feature', 'abc123'], { cwd: '/repo' });
  });

  it('switches to a branch', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await switchBranch('/repo', 'main', executor);
    expect(executor).toHaveBeenCalledWith(['switch', '--', 'main'], { cwd: '/repo' });
  });

  it('renames a branch', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await renameBranch('/repo', 'old', 'new', executor);
    expect(executor).toHaveBeenCalledWith(['branch', '--move', '--', 'old', 'new'], { cwd: '/repo' });
  });

  it('throws git stderr on failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'fatal: a branch named X already exists' }));
    await expect(createBranch('/repo', 'X', undefined, executor)).rejects.toThrow(/already exists/);
  });
});

describe('isBranchMerged', () => {
  it('reports merged when git branch --list --merged returns the branch', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '  feature\n', stderr: '' }));
    expect(await isBranchMerged('/repo', 'feature', 'main', executor)).toBe(true);
  });

  it('reports not merged when output is empty', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    expect(await isBranchMerged('/repo', 'feature', 'main', executor)).toBe(false);
  });
});

describe('deleteBranch (structural confirmation gate)', () => {
  it('refuses to run when confirmed is false, before ever calling the executor', async () => {
    const executor: GitExecutor = vi.fn();
    await expect(deleteBranch('/repo', 'feature', { force: false, confirmed: false }, executor)).rejects.toThrow(
      DestructiveGitActionNotConfirmedError,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it('uses -d for a safe (merged) delete and -D for a forced delete, once confirmed', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await deleteBranch('/repo', 'feature', { force: false, confirmed: true }, executor);
    expect(executor).toHaveBeenCalledWith(['branch', '-d', '--', 'feature'], { cwd: '/repo' });

    await deleteBranch('/repo', 'feature', { force: true, confirmed: true }, executor);
    expect(executor).toHaveBeenCalledWith(['branch', '-D', '--', 'feature'], { cwd: '/repo' });
  });
});

describe('setUpstream', () => {
  it('sets the tracking branch', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await setUpstream('/repo', 'origin', 'main', executor);
    expect(executor).toHaveBeenCalledWith(['branch', '--set-upstream-to=origin/main', 'main'], { cwd: '/repo' });
  });
});

describe('compareBranches', () => {
  it('parses a numstat diff between two refs and totals added/removed lines', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '3\t1\ta.txt\x00-\t-\tbinary.png\x00', stderr: '' }));
    const comparison = await compareBranches('/repo', 'main', 'feature', executor);
    expect(comparison.files).toHaveLength(2);
    expect(comparison.totalAdded).toBe(3);
    expect(comparison.totalRemoved).toBe(1);
    expect(executor).toHaveBeenCalledWith(
      ['diff', '--no-ext-diff', '--numstat', '-z', 'main...feature'],
      { cwd: '/repo' },
    );
  });
});
