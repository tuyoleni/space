import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import type { GitDirFsPort } from './repository-state';
import { getFullRepositoryStatus, isInsideWorkTree, resolveGitDir, resolveRepositoryRoot } from './repository';

describe('resolveRepositoryRoot / isInsideWorkTree / resolveGitDir', () => {
  it('resolves the toplevel path', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '/repo\n', stderr: '' }));
    expect(await resolveRepositoryRoot('/repo/sub', executor)).toBe('/repo');
  });

  it('reports not inside a work tree', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: '' }));
    expect(await isInsideWorkTree('/scratch', executor)).toBe(false);
  });

  it('resolves a relative git-dir against cwd', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '.git\n', stderr: '' }));
    expect(await resolveGitDir('/repo', executor)).toBe('/repo/.git');
  });

  it('leaves an absolute git-dir unchanged', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '/elsewhere/.git\n', stderr: '' }));
    expect(await resolveGitDir('/repo', executor)).toBe('/elsewhere/.git');
  });
});

describe('getFullRepositoryStatus', () => {
  it('combines status and in-progress operation state in one read', async () => {
    const executor: GitExecutor = vi.fn(async (args) => {
      if (args.includes('--git-dir')) return { exitCode: 0, stdout: '.git\n', stderr: '' };
      return { exitCode: 0, stdout: '# branch.oid abc\x00# branch.head main\x00', stderr: '' };
    });
    const gitDirFs: GitDirFsPort = { exists: async (p) => p === '/repo/.git/MERGE_HEAD' };

    const full = await getFullRepositoryStatus('/repo', executor, gitDirFs);
    expect(full.gitDir).toBe('/repo/.git');
    expect(full.status.branch.branchName).toBe('main');
    expect(full.operationState).toEqual({ kind: 'merge' });
  });

  it('throws when the directory is not inside a Git working tree', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: 'not a git repository' }));
    const gitDirFs: GitDirFsPort = { exists: async () => false };
    await expect(getFullRepositoryStatus('/scratch', executor, gitDirFs)).rejects.toThrow(/not inside a Git working tree/);
  });
});
