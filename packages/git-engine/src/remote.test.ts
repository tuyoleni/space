import { describe, expect, it, vi } from 'vitest';
import { DestructiveGitActionNotConfirmedError } from '@space/domain';
import type { GitExecutor } from './clone';
import type { GitIdentity } from './identity';
import { describePush, fetchRemote, pullRemote, pushToRemote } from './remote';

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
