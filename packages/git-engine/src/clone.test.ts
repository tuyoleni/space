import { describe, expect, it, vi } from 'vitest';
import { cloneArgs, cloneRepository, validateCloneDestination, validateCloneSource } from './clone';
import type { GitExecutor } from './clone';

describe('validateCloneSource / validateCloneDestination', () => {
  it('rejects empty values', () => {
    expect(() => validateCloneSource('')).toThrow(/empty/);
    expect(() => validateCloneDestination('  ')).toThrow(/empty/);
  });

  it('rejects values that look like a flag (command-injection defence)', () => {
    expect(() => validateCloneSource('--upload-pack=evil')).toThrow(/must not start with/);
    expect(() => validateCloneDestination('-rf')).toThrow(/must not start with/);
  });

  it('accepts an ordinary path or URL', () => {
    expect(() => validateCloneSource('/tmp/fixture-repo')).not.toThrow();
    expect(() => validateCloneSource('https://github.com/example/repo.git')).not.toThrow();
  });
});

describe('cloneArgs', () => {
  it('always separates flags from values with "--"', () => {
    const args = cloneArgs({ remoteUrl: '/tmp/src', destination: '/tmp/dest' });
    expect(args).toEqual(['clone', '--', '/tmp/src', '/tmp/dest']);
  });

  it('includes --branch when a branch is requested', () => {
    const args = cloneArgs({ remoteUrl: '/tmp/src', destination: '/tmp/dest', branch: 'main' });
    expect(args).toEqual(['clone', '--branch', 'main', '--', '/tmp/src', '/tmp/dest']);
  });

  it('rejects a branch name that looks like a flag', () => {
    expect(() =>
      cloneArgs({ remoteUrl: '/tmp/src', destination: '/tmp/dest', branch: '--upload-pack=evil' }),
    ).toThrow(/not valid/);
  });
});

describe('cloneRepository', () => {
  it('invokes the injected executor with the constructed args and returns the destination', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: 'Cloning...', stderr: '' }));
    const result = await cloneRepository({ remoteUrl: '/tmp/src', destination: '/tmp/dest' }, executor);
    expect(executor).toHaveBeenCalledWith(['clone', '--', '/tmp/src', '/tmp/dest'], {});
    expect(result.destination).toBe('/tmp/dest');
  });

  it('throws with stderr detail on a non-zero exit, never swallowing the failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: repository not found',
    }));
    await expect(cloneRepository({ remoteUrl: '/tmp/src', destination: '/tmp/dest' }, executor)).rejects.toThrow(
      /repository not found/,
    );
  });

  it('validates before ever calling the executor', async () => {
    const executor: GitExecutor = vi.fn();
    await expect(cloneRepository({ remoteUrl: '', destination: '/tmp/dest' }, executor)).rejects.toThrow();
    expect(executor).not.toHaveBeenCalled();
  });
});
