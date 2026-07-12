import { describe, expect, it } from 'vitest';
import type { GitExecutor } from '@space/git-engine';
import { setupAndVerifyGitCredentialHelper, setupGitArgs, setupGitCredentialHelper, verifyGitCredentialHelper } from './setup-git';
import type { GhExecutor } from './executor';

describe('setupGitArgs', () => {
  it('builds a bare command by default', () => {
    expect(setupGitArgs()).toEqual(['auth', 'setup-git']);
  });

  it('includes hostname when supplied', () => {
    expect(setupGitArgs('github.com')).toEqual(['auth', 'setup-git', '--hostname', 'github.com']);
  });
});

describe('setupGitCredentialHelper', () => {
  it('runs gh auth setup-git for real through the injected executor', async () => {
    const ghExecutor: GhExecutor = async (args) => {
      expect(args).toEqual(['auth', 'setup-git']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(setupGitCredentialHelper(ghExecutor)).resolves.toBeUndefined();
  });

  it('throws with the real stderr on failure', async () => {
    const ghExecutor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    await expect(setupGitCredentialHelper(ghExecutor)).rejects.toThrow(/not logged in/);
  });
});

describe('verifyGitCredentialHelper', () => {
  it('rejects an empty or flag-like remote URL', async () => {
    const gitExecutor: GitExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' });
    await expect(verifyGitCredentialHelper('', gitExecutor)).rejects.toThrow();
    await expect(verifyGitCredentialHelper('--upload-pack=evil', gitExecutor)).rejects.toThrow();
  });

  it('reports verified:true on a successful non-destructive ls-remote', async () => {
    const gitExecutor: GitExecutor = async (args) => {
      expect(args).toEqual(['ls-remote', '--exit-code', '--', 'https://github.com/acme/widgets.git', 'HEAD']);
      return { exitCode: 0, stdout: 'abcdef1234\tHEAD\n', stderr: '' };
    };
    const result = await verifyGitCredentialHelper('https://github.com/acme/widgets.git', gitExecutor);
    expect(result).toEqual({ verified: true, detail: 'abcdef1234\tHEAD' });
  });

  it('reports verified:false with the real stderr on an authentication failure, without throwing', async () => {
    const gitExecutor: GitExecutor = async () => ({ exitCode: 128, stdout: '', stderr: 'remote: Repository not found.' });
    const result = await verifyGitCredentialHelper('https://github.com/acme/widgets.git', gitExecutor);
    expect(result).toEqual({ verified: false, detail: 'remote: Repository not found.' });
  });
});

describe('setupAndVerifyGitCredentialHelper', () => {
  it('runs setup then verification in order', async () => {
    const calls: string[] = [];
    const ghExecutor: GhExecutor = async (args) => {
      calls.push(`gh ${args.join(' ')}`);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const gitExecutor: GitExecutor = async (args) => {
      calls.push(`git ${args.join(' ')}`);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    const result = await setupAndVerifyGitCredentialHelper('https://github.com/acme/widgets.git', ghExecutor, gitExecutor);
    expect(result.verified).toBe(true);
    expect(calls[0]).toContain('gh auth setup-git');
    expect(calls[1]).toContain('git ls-remote');
  });
});
