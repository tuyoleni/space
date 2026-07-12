import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import {
  checkSigningKeyAvailability,
  identityConfigArgs,
  readRepoLocalIdentity,
  resolveCommitIdentity,
  type GitIdentity,
} from './identity';

const workspaceIdentity: GitIdentity = {
  name: 'Workspace Person',
  email: 'workspace@example.com',
  signingPolicy: 'none',
  signingKeyId: null,
};

describe('resolveCommitIdentity', () => {
  it('uses the workspace identity when the repo has no local identity', () => {
    const resolution = resolveCommitIdentity({
      workspaceIdentity,
      repoLocal: { name: null, email: null },
      overrideAcknowledged: false,
    });
    expect(resolution).toEqual({ identity: workspaceIdentity, source: 'workspace', mismatch: false });
  });

  it('flags a mismatch but keeps the workspace identity until explicitly acknowledged', () => {
    const resolution = resolveCommitIdentity({
      workspaceIdentity,
      repoLocal: { name: 'Repo Person', email: 'repo@example.com' },
      overrideAcknowledged: false,
    });
    expect(resolution.source).toBe('workspace');
    expect(resolution.mismatch).toBe(true);
  });

  it('uses the repo-local identity only after an explicit acknowledgement', () => {
    const resolution = resolveCommitIdentity({
      workspaceIdentity,
      repoLocal: { name: 'Repo Person', email: 'repo@example.com' },
      overrideAcknowledged: true,
    });
    expect(resolution.source).toBe('repo-local');
    expect(resolution.identity.name).toBe('Repo Person');
    expect(resolution.identity.email).toBe('repo@example.com');
    expect(resolution.mismatch).toBe(false);
  });

  it('reports no mismatch when the repo-local identity matches the workspace identity', () => {
    const resolution = resolveCommitIdentity({
      workspaceIdentity,
      repoLocal: { name: workspaceIdentity.name, email: workspaceIdentity.email },
      overrideAcknowledged: false,
    });
    expect(resolution.mismatch).toBe(false);
  });
});

describe('identityConfigArgs', () => {
  it('injects name/email and disables signing for policy "none"', () => {
    expect(identityConfigArgs(workspaceIdentity)).toEqual([
      '-c', 'user.name=Workspace Person',
      '-c', 'user.email=workspace@example.com',
      '-c', 'commit.gpgsign=false',
    ]);
  });

  it('enables gpg signing with the configured key', () => {
    const identity: GitIdentity = { ...workspaceIdentity, signingPolicy: 'gpg', signingKeyId: 'ABCDEF' };
    const args = identityConfigArgs(identity);
    expect(args).toContain('commit.gpgsign=true');
    expect(args).toContain('gpg.format=openpgp');
    expect(args).toContain('user.signingkey=ABCDEF');
  });

  it('enables ssh signing format', () => {
    const identity: GitIdentity = { ...workspaceIdentity, signingPolicy: 'ssh', signingKeyId: '/path/to/key.pub' };
    const args = identityConfigArgs(identity);
    expect(args).toContain('gpg.format=ssh');
  });
});

describe('readRepoLocalIdentity', () => {
  it('returns null fields when no local identity is configured', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' }));
    expect(await readRepoLocalIdentity('/repo', executor)).toEqual({ name: null, email: null });
  });

  it('reads local name/email when present', async () => {
    const executor: GitExecutor = vi.fn(async (args) =>
      args.includes('user.name')
        ? { exitCode: 0, stdout: 'Repo Person\n', stderr: '' }
        : { exitCode: 0, stdout: 'repo@example.com\n', stderr: '' },
    );
    expect(await readRepoLocalIdentity('/repo', executor)).toEqual({ name: 'Repo Person', email: 'repo@example.com' });
  });
});

describe('checkSigningKeyAvailability', () => {
  it('returns null (not applicable) when signing policy is none', async () => {
    const checker = vi.fn();
    expect(await checkSigningKeyAvailability(workspaceIdentity, checker)).toBeNull();
    expect(checker).not.toHaveBeenCalled();
  });

  it('returns false when signing is required but no key is configured', async () => {
    const identity: GitIdentity = { ...workspaceIdentity, signingPolicy: 'gpg', signingKeyId: null };
    expect(await checkSigningKeyAvailability(identity, vi.fn())).toBe(false);
  });

  it('delegates to the injected checker when a key is configured', async () => {
    const identity: GitIdentity = { ...workspaceIdentity, signingPolicy: 'gpg', signingKeyId: 'ABCDEF' };
    const checker = vi.fn(async () => true);
    expect(await checkSigningKeyAvailability(identity, checker)).toBe(true);
    expect(checker).toHaveBeenCalledWith('gpg', 'ABCDEF');
  });
});
