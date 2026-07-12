import { describe, expect, it, vi } from 'vitest';
import {
  activeAccountFor,
  detectGhVersion,
  getGitProtocol,
  ghAuthLoginArgs,
  ghAuthLogoutArgs,
  listAvailableOrgs,
  loadAuthStatus,
  loadGithubAuthReport,
  logout,
  parseAuthStatus,
  parseGhVersion,
} from './auth';
import type { GhExecutor } from './executor';

function fakeExecutor(handler: (args: readonly string[]) => { exitCode: number | null; stdout: string; stderr: string }): GhExecutor {
  return async (args) => handler(args);
}

describe('parseGhVersion', () => {
  it('parses the version from the first line', () => {
    expect(parseGhVersion('gh version 2.95.0 (2025-06-10)\nhttps://github.com/cli/cli/releases/tag/v2.95.0\n')).toBe('2.95.0');
  });

  it('returns null for unrecognised output', () => {
    expect(parseGhVersion('not gh output')).toBeNull();
  });
});

describe('detectGhVersion', () => {
  it('reports installed:false when gh is missing', async () => {
    const executor: GhExecutor = async () => {
      throw new Error('ENOENT: gh not found');
    };
    const report = await detectGhVersion(executor);
    expect(report.installed).toBe(false);
    expect(report.version).toBeNull();
  });

  it('reports installed:true with a parsed version on success', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: 'gh version 2.95.0 (2025-06-10)\n', stderr: '' }));
    const report = await detectGhVersion(executor);
    expect(report).toEqual({ installed: true, version: '2.95.0', raw: 'gh version 2.95.0 (2025-06-10)\n' });
  });
});

const SINGLE_ACCOUNT_STATUS = `github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo'
`;

const MULTI_ACCOUNT_STATUS = `github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'repo', 'read:org'
  ✓ Logged in to github.com account monalisa (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'repo'
`;

const NOT_LOGGED_IN = `You are not logged into any GitHub hosts. Run gh auth login to authenticate.
`;

describe('parseAuthStatus', () => {
  it('parses a single logged-in account and never captures a token value', () => {
    const report = parseAuthStatus(SINGLE_ACCOUNT_STATUS, 0);
    expect(report.authenticated).toBe(true);
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]).toEqual({
      host: 'github.com',
      account: 'octocat',
      active: true,
      tokenSource: 'keyring',
      scopes: ['gist', 'read:org', 'repo'],
    });
    expect(JSON.stringify(report)).not.toMatch(/gho_/);
  });

  it('parses multiple accounts on the same host and their active flag', () => {
    const report = parseAuthStatus(MULTI_ACCOUNT_STATUS, 0);
    expect(report.accounts).toHaveLength(2);
    expect(report.accounts.find((a) => a.account === 'octocat')?.active).toBe(true);
    expect(report.accounts.find((a) => a.account === 'monalisa')?.active).toBe(false);
  });

  it('reports authenticated:false with no accounts when logged out', () => {
    const report = parseAuthStatus(NOT_LOGGED_IN, 1);
    expect(report.authenticated).toBe(false);
    expect(report.accounts).toHaveLength(0);
  });
});

describe('loadAuthStatus', () => {
  it('runs gh auth status and parses the combined output', async () => {
    const executor = fakeExecutor((args) => {
      expect(args).toEqual(['auth', 'status']);
      return { exitCode: 0, stdout: SINGLE_ACCOUNT_STATUS, stderr: '' };
    });
    const report = await loadAuthStatus(executor);
    expect(report.authenticated).toBe(true);
  });
});

describe('activeAccountFor', () => {
  it('returns the account flagged active', () => {
    const report = parseAuthStatus(MULTI_ACCOUNT_STATUS, 0);
    expect(activeAccountFor(report)?.account).toBe('octocat');
  });

  it('falls back to the sole account when none is flagged active', () => {
    const report = parseAuthStatus(SINGLE_ACCOUNT_STATUS.replace('Active account: true', 'Active account: false'), 0);
    expect(activeAccountFor(report)?.account).toBe('octocat');
  });
});

describe('listAvailableOrgs', () => {
  it('parses the jq-shaped org array', async () => {
    const executor = fakeExecutor((args) => {
      expect(args[0]).toBe('api');
      expect(args).toContain('user/orgs');
      return { exitCode: 0, stdout: JSON.stringify([{ login: 'acme', id: 1 }]), stderr: '' };
    });
    expect(await listAvailableOrgs(executor)).toEqual([{ login: 'acme', id: 1 }]);
  });

  it('returns null (not obtainable) rather than throwing on failure', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 1, stdout: '', stderr: 'HTTP 404' }));
    expect(await listAvailableOrgs(executor)).toBeNull();
  });
});

describe('getGitProtocol', () => {
  it('parses a bare scalar config value', async () => {
    const executor = fakeExecutor((args) => {
      expect(args).toEqual(['config', 'get', 'git_protocol']);
      return { exitCode: 0, stdout: 'https\n', stderr: '' };
    });
    expect(await getGitProtocol(executor)).toBe('https');
  });

  it('returns null on failure', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 1, stdout: '', stderr: 'not set' }));
    expect(await getGitProtocol(executor)).toBeNull();
  });
});

describe('loadGithubAuthReport', () => {
  it('assembles the full report when gh is installed and authenticated', async () => {
    const calls: string[][] = [];
    const executor = fakeExecutor((args) => {
      calls.push([...args]);
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.95.0 (2025-06-10)\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status') return { exitCode: 0, stdout: SINGLE_ACCOUNT_STATUS, stderr: '' };
      if (args[0] === 'api') return { exitCode: 0, stdout: JSON.stringify([{ login: 'acme', id: 1 }]), stderr: '' };
      if (args[0] === 'config') return { exitCode: 0, stdout: 'https\n', stderr: '' };
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });

    const report = await loadGithubAuthReport(executor, { tokenSourceStrategy: 'space-managed-os-keychain' });
    expect(report).toEqual({
      cliInstalled: true,
      cliVersion: '2.95.0',
      authenticated: true,
      accounts: [{ host: 'github.com', account: 'octocat', active: true, tokenSource: 'keyring', scopes: ['gist', 'read:org', 'repo'] }],
      activeAccount: { host: 'github.com', account: 'octocat', active: true, tokenSource: 'keyring', scopes: ['gist', 'read:org', 'repo'] },
      availableOrgs: [{ login: 'acme', id: 1 }],
      gitProtocol: 'https',
      tokenSourceStrategy: 'space-managed-os-keychain',
    });
  });

  it('short-circuits with cliInstalled:false and never calls auth status when gh is missing', async () => {
    const executor: GhExecutor = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    const report = await loadGithubAuthReport(executor, { tokenSourceStrategy: 'unknown' });
    expect(report.cliInstalled).toBe(false);
    expect(report.authenticated).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('does not call the orgs API when not authenticated', async () => {
    const calls: string[][] = [];
    const executor = fakeExecutor((args) => {
      calls.push([...args]);
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.95.0 (2025-06-10)\n', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status') return { exitCode: 1, stdout: '', stderr: NOT_LOGGED_IN };
      if (args[0] === 'config') return { exitCode: 0, stdout: 'https\n', stderr: '' };
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const report = await loadGithubAuthReport(executor, { tokenSourceStrategy: 'unknown' });
    expect(report.authenticated).toBe(false);
    expect(report.availableOrgs).toBeNull();
    expect(calls.some((call) => call[0] === 'api')).toBe(false);
  });
});

describe('ghAuthLoginArgs', () => {
  it('builds a bare login command by default', () => {
    expect(ghAuthLoginArgs()).toEqual(['auth', 'login']);
  });

  it('includes hostname, protocol, web, and scopes when supplied', () => {
    expect(ghAuthLoginArgs({ hostname: 'github.com', gitProtocol: 'https', web: true, scopes: ['repo', 'read:org'] })).toEqual([
      'auth',
      'login',
      '--hostname',
      'github.com',
      '--git-protocol',
      'https',
      '--web',
      '--scopes',
      'repo,read:org',
    ]);
  });
});

describe('ghAuthLogoutArgs / logout', () => {
  it('builds a bare logout command by default', () => {
    expect(ghAuthLogoutArgs()).toEqual(['auth', 'logout']);
  });

  it('runs logout for real through the injected executor', async () => {
    const executor = fakeExecutor((args) => {
      expect(args).toEqual(['auth', 'logout', '--hostname', 'github.com']);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await expect(logout(executor, 'github.com')).resolves.toBeUndefined();
  });
});
