import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import {
  checkForEnclosingRepository,
  classifyDetectedRisks,
  initRepository,
  resolveDefaultBranchName,
  runInitPreflight,
} from './init';

describe('resolveDefaultBranchName', () => {
  it('defaults to main when nothing is requested', () => {
    expect(resolveDefaultBranchName()).toBe('main');
    expect(resolveDefaultBranchName('  ')).toBe('main');
  });

  it('accepts a valid requested branch name', () => {
    expect(resolveDefaultBranchName('trunk')).toBe('trunk');
  });

  it('rejects a name that looks like a flag or contains whitespace', () => {
    expect(() => resolveDefaultBranchName('-x')).toThrow(/not a valid/);
    expect(() => resolveDefaultBranchName('has space')).toThrow(/not a valid/);
    expect(() => resolveDefaultBranchName('HEAD')).toThrow(/not a valid/);
  });
});

describe('checkForEnclosingRepository', () => {
  it('returns the toplevel path when already inside a repository', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '/repo/root\n', stderr: '' }));
    expect(await checkForEnclosingRepository('/repo/root/sub', executor)).toBe('/repo/root');
  });

  it('returns null when not inside any repository', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }));
    expect(await checkForEnclosingRepository('/scratch', executor)).toBeNull();
  });
});

describe('classifyDetectedRisks', () => {
  it('separates env-file and generated-directory facts from everything else', () => {
    const risks = classifyDetectedRisks([
      { category: 'env-file', label: '.env' },
      { category: 'generated-directory', label: 'node_modules' },
      { category: 'runtime', label: 'Node.js project' },
    ]);
    expect(risks).toEqual({ likelySecrets: ['.env'], likelyGeneratedDirectories: ['node_modules'] });
  });
});

describe('runInitPreflight', () => {
  it('combines nested-repo detection, write access, default branch, and risk facts', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: '' }));
    const result = await runInitPreflight('/new/project', undefined, {
      executor,
      canWrite: async () => true,
      detectedFacts: [{ category: 'env-file', label: '.env' }],
    });
    expect(result).toEqual({
      defaultBranch: 'main',
      nestedRepositoryWarning: null,
      writeAccess: true,
      canProceed: true,
      likelySecrets: ['.env'],
      likelyGeneratedDirectories: [],
    });
  });

  it('blocks proceeding when write access is denied', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: '' }));
    const result = await runInitPreflight('/readonly', undefined, { executor, canWrite: async () => false });
    expect(result.canProceed).toBe(false);
  });

  it('surfaces a nested-repository warning with the enclosing toplevel path', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '/enclosing\n', stderr: '' }));
    const result = await runInitPreflight('/enclosing/sub', undefined, { executor, canWrite: async () => true });
    expect(result.nestedRepositoryWarning).toBe('/enclosing');
  });
});

describe('initRepository', () => {
  it('runs the real init command with the resolved branch', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await initRepository('/new/project', 'main', executor);
    expect(executor).toHaveBeenCalledWith(['init', '--initial-branch=main'], { cwd: '/new/project' });
  });

  it('throws on failure rather than pretending success', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'fatal: cannot init' }));
    await expect(initRepository('/new/project', 'main', executor)).rejects.toThrow(/cannot init/);
  });
});
