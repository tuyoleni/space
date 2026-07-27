import { describe, expect, it, vi } from 'vitest';
import { HOMEBREW_LARGE_INSTALL_TIMEOUT_MS, HOMEBREW_RELIABILITY_ENV, runHomebrewCommand } from './homebrew';
import type { CommandRunner } from './types';

describe('runHomebrewCommand', () => {
  it('applies large-download limits and process-local Git/curl reliability settings', async () => {
    const runner: CommandRunner = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));

    await runHomebrewCommand(['install', 'large-tool'], { runner });

    expect(runner).toHaveBeenCalledWith('brew', ['install', 'large-tool'], expect.objectContaining({
      timeoutMs: HOMEBREW_LARGE_INSTALL_TIMEOUT_MS,
      env: HOMEBREW_RELIABILITY_ENV,
    }));
  });

  it('retries transient large Git failures and then succeeds', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'RPC failed; curl 92 HTTP/2 stream was not closed cleanly' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'installed', stderr: '' }) as CommandRunner;

    await expect(runHomebrewCommand(['install', 'large-tool'], { runner })).resolves.toMatchObject({ exitCode: 0 });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic package failures', async () => {
    const runner = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'No available formula with the name "missing".' }));

    await runHomebrewCommand(['install', 'missing'], { runner });

    expect(runner).toHaveBeenCalledTimes(1);
  });
});
