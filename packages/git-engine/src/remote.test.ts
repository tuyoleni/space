import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DestructiveGitActionNotConfirmedError } from '@space/domain';
import type { GitExecutor } from './clone';
import type { GitIdentity } from './identity';
import { createNodeGitExecutor } from './node-git-executor';
import { addRemote, describePush, fetchRemote, getRemoteUrl, listRemotes, parseRemoteVerbose, pullRemote, pushToRemote } from './remote';

const identity: GitIdentity = { name: 'A', email: 'a@example.com', signingPolicy: 'none', signingKeyId: null };

describe('fetchRemote / pullRemote', () => {
  it('fetches with prune', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await fetchRemote('/repo', 'origin', executor);
    expect(executor).toHaveBeenCalledWith(['fetch', '--prune', '--', 'origin'], { cwd: '/repo' });
  });

  it('pulls with explicit rebase mode', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await pullRemote('/repo', 'rebase', 'origin', 'main', executor);
    expect(executor).toHaveBeenCalledWith(['pull', '--rebase', '--', 'origin', 'main'], { cwd: '/repo' });
  });

  it('throws on failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'fatal: could not read from remote' }));
    await expect(fetchRemote('/repo', 'origin', executor)).rejects.toThrow(/could not read from remote/);
  });
});

describe('addRemote / getRemoteUrl', () => {
  it('adds a remote by name and URL', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await addRemote('/repo', 'origin', 'https://github.com/acme/widgets.git', executor);
    expect(executor).toHaveBeenCalledWith(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: '/repo' });
  });

  it('throws when the remote name already exists', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 3, stdout: '', stderr: "error: remote origin already exists." }));
    await expect(addRemote('/repo', 'origin', 'https://github.com/acme/widgets.git', executor)).rejects.toThrow(/already exists/);
  });

  it('returns the URL for an existing remote', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: 'https://github.com/acme/widgets.git\n', stderr: '' }));
    await expect(getRemoteUrl('/repo', 'origin', executor)).resolves.toBe('https://github.com/acme/widgets.git');
  });

  it('returns null when the remote does not exist', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: 'error: No such remote' }));
    await expect(getRemoteUrl('/repo', 'origin', executor)).resolves.toBeNull();
  });
});

describe('parseRemoteVerbose', () => {
  it('pairs the fetch and push lines of each remote and preserves first-seen order', () => {
    const stdout = [
      'origin\thttps://github.com/acme/widgets.git (fetch)',
      'origin\thttps://github.com/acme/widgets.git (push)',
      'upstream\tgit@github.com:upstream/widgets.git (fetch)',
      'upstream\tgit@github.com:upstream/widgets.git (push)',
    ].join('\n');
    expect(parseRemoteVerbose(stdout)).toEqual([
      { name: 'origin', fetchUrl: 'https://github.com/acme/widgets.git', pushUrl: 'https://github.com/acme/widgets.git' },
      { name: 'upstream', fetchUrl: 'git@github.com:upstream/widgets.git', pushUrl: 'git@github.com:upstream/widgets.git' },
    ]);
  });

  it('keeps a distinct push URL when one is configured, and returns [] for no remotes', () => {
    const stdout = [
      'origin\thttps://github.com/acme/widgets.git (fetch)',
      'origin\tssh://git@github.com/acme/widgets.git (push)',
    ].join('\n');
    expect(parseRemoteVerbose(stdout)[0]).toEqual({
      name: 'origin',
      fetchUrl: 'https://github.com/acme/widgets.git',
      pushUrl: 'ssh://git@github.com/acme/widgets.git',
    });
    expect(parseRemoteVerbose('')).toEqual([]);
  });
});

describe('listRemotes against a real repo', () => {
  let dir: string;
  let git: GitExecutor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-remote-'));
    git = createNodeGitExecutor();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] with no remotes and reads a real remote after it is added', async () => {
    await expect(listRemotes(dir, git)).resolves.toEqual([]);
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: dir });
    await expect(listRemotes(dir, git)).resolves.toEqual([
      { name: 'origin', fetchUrl: 'https://github.com/acme/widgets.git', pushUrl: 'https://github.com/acme/widgets.git' },
    ]);
  });
});

describe('describePush', () => {
  it('summarizes identity, remote, branch, and force state before any push runs', () => {
    expect(describePush({ branch: 'main' }, identity)).toEqual({
      identity: 'A <a@example.com>',
      remote: 'origin',
      branch: 'main',
      forceState: 'none',
    });
    expect(describePush({ branch: 'main', force: 'raw' }, identity).forceState).toBe('raw');
  });
});

describe('pushToRemote', () => {
  it('pushes normally without requiring confirmation', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await pushToRemote('/repo', { branch: 'main' }, executor);
    expect(executor).toHaveBeenCalledWith(['push', '--', 'origin', 'main'], { cwd: '/repo' });
  });

  it('requires confirmation for --force-with-lease', async () => {
    const executor: GitExecutor = vi.fn();
    await expect(pushToRemote('/repo', { branch: 'main', force: 'with-lease' }, executor)).rejects.toThrow(
      DestructiveGitActionNotConfirmedError,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it('allows --force-with-lease once confirmed, without needing the raw-force policy gate', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await pushToRemote('/repo', { branch: 'main', force: 'with-lease', confirmed: true }, executor);
    expect(executor).toHaveBeenCalledWith(['push', '--force-with-lease', '--', 'origin', 'main'], { cwd: '/repo' });
  });

  it('blocks raw --force even when confirmed unless the policy gate explicitly allows it', async () => {
    const executor: GitExecutor = vi.fn();
    await expect(pushToRemote('/repo', { branch: 'main', force: 'raw', confirmed: true }, executor)).rejects.toThrow(
      DestructiveGitActionNotConfirmedError,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it('allows raw --force only when both confirmed and the policy gate is set', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await pushToRemote('/repo', { branch: 'main', force: 'raw', confirmed: true, policyAllowsRawForce: true }, executor);
    expect(executor).toHaveBeenCalledWith(['push', '--force', '--', 'origin', 'main'], { cwd: '/repo' });
  });
});
