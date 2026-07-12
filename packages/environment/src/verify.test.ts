import { describe, expect, it } from 'vitest';
import { verifyTool } from './verify';
import { TOOL_MANIFEST } from './manifest';
import type { CommandExecutionResult, CommandOnPathResolver, CommandRunner } from './types';

const GIT = TOOL_MANIFEST.entries.find((e) => e.id === 'git')!;
const VOLTA = TOOL_MANIFEST.entries.find((e) => e.id === 'volta')!;

function deps(overrides: {
  resolveOnPath?: CommandOnPathResolver;
  runCommand?: CommandRunner;
  architecture?: string;
}) {
  return {
    resolveOnPath: overrides.resolveOnPath ?? (async () => '/usr/bin/git'),
    runCommand: overrides.runCommand ?? (async (): Promise<CommandExecutionResult> => ({ exitCode: 0, stdout: '', stderr: '' })),
    architecture: overrides.architecture ?? 'arm64',
  };
}

describe('verifyTool (spec section 8.7, ONB-007)', () => {
  it('fails when the executable cannot be re-resolved, even if told the installer succeeded', async () => {
    const outcome = await verifyTool(GIT, deps({ resolveOnPath: async () => null }));
    expect(outcome.verified).toBe(false);
    expect(outcome.resolved).toBe(false);
    expect(outcome.failureReason).toContain('freshly constructed environment');
  });

  it('verifies successfully when version and functional checks both pass', async () => {
    const outcome = await verifyTool(
      GIT,
      deps({
        runCommand: async (_exe, args) => {
          if (args.includes('--version')) {
            return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      }),
    );
    expect(outcome.verified).toBe(true);
    expect(outcome.version).toBe('2.45.0');
    expect(outcome.meetsMinimumVersion).toBe(true);
  });

  it('never treats installer exit code zero as success: fails when the real environment lacks the tool regardless', async () => {
    // Simulates the exact prohibited shortcut (spec section 39): the
    // installer step itself reported exit code 0, but verifyTool's
    // signature has no such parameter to consult — it independently
    // re-resolves and fails because the tool genuinely isn't there.
    const outcome = await verifyTool(GIT, deps({ resolveOnPath: async () => null }));
    expect(outcome.verified).toBe(false);
  });

  it('fails when the version is below the manifest minimum', async () => {
    const outcome = await verifyTool(
      GIT,
      deps({
        runCommand: async (_exe, args) => {
          if (args.includes('--version')) {
            return { exitCode: 0, stdout: 'git version 2.10.0', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      }),
    );
    expect(outcome.verified).toBe(false);
    expect(outcome.meetsMinimumVersion).toBe(false);
    expect(outcome.failureReason).toContain('below the minimum');
  });

  it('fails when the version output does not match the expected pattern', async () => {
    const outcome = await verifyTool(
      GIT,
      deps({
        runCommand: async (_exe, args) => {
          if (args.includes('--version')) {
            return { exitCode: 0, stdout: 'not a version string', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      }),
    );
    expect(outcome.verified).toBe(false);
    expect(outcome.failureReason).toContain('expected pattern');
  });

  it('fails when the functional command exits non-zero', async () => {
    const outcome = await verifyTool(
      VOLTA,
      deps({
        runCommand: async (_exe, args) => {
          if (args.includes('--version')) {
            return { exitCode: 0, stdout: '2.0.1', stderr: '' };
          }
          if (args.includes('list')) {
            return { exitCode: 1, stdout: '', stderr: 'volta: not configured' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      }),
    );
    expect(outcome.verified).toBe(false);
    expect(outcome.functionalCheckPassed).toBe(false);
    expect(outcome.failureReason).toContain('exited with code 1');
  });

  it('reports architecture incompatibility', async () => {
    const entryWithLimitedArch = { ...GIT, architectures: ['x64'] };
    const outcome = await verifyTool(
      entryWithLimitedArch,
      deps({
        architecture: 'arm64',
        runCommand: async (_exe, args) => {
          if (args.includes('--version')) {
            return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      }),
    );
    expect(outcome.architectureCompatible).toBe(false);
    expect(outcome.verified).toBe(false);
  });
});
