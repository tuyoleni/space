import { describe, expect, it } from 'vitest';
import { RedactionRegistry } from '@space/workspace-runner';
import { executePlanSteps, executeStep } from './orchestrator';
import type { CommandExecutionResult, PlannedStep, ScanToolResult, VerificationOutcome } from './types';

function makeStep(overrides: Partial<PlannedStep> = {}): PlannedStep {
  return {
    id: 'install-git',
    sequence: 0,
    toolId: 'git',
    kind: 'tool-install',
    displayName: 'Git',
    humanExplanation: 'Install Git via Homebrew.',
    strategy: {
      id: 'git-homebrew',
      platform: 'darwin',
      kind: 'package-manager',
      packageManagerId: 'homebrew',
      packageId: 'git',
      executable: 'brew',
      args: ['install', 'git'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'Homebrew',
      officialSourceUrl: 'https://brew.sh',
    },
    requiresElevation: false,
    interactive: false,
    changesMachineState: true,
    deferredImplementation: false,
    ...overrides,
  };
}

function verified(toolId: string, overrides: Partial<VerificationOutcome> = {}): VerificationOutcome {
  return {
    toolId,
    resolved: true,
    resolvedPath: '/usr/bin/git',
    versionOutput: 'git version 2.45.0',
    version: '2.45.0',
    meetsMinimumVersion: true,
    functionalCheckPassed: true,
    architectureCompatible: true,
    needsRestart: false,
    verified: true,
    failureReason: null,
    ...overrides,
  };
}

describe('executeStep (spec sections 8.6-8.8)', () => {
  it('skips an already-satisfied tool without running the installer', async () => {
    const runInstaller = async (): Promise<CommandExecutionResult> => {
      throw new Error('should not be called');
    };
    const prior: ScanToolResult = { toolId: 'git', found: true, path: '/usr/bin/git', version: '2.45.0', meetsMinimumVersion: true };
    const record = await executeStep(makeStep(), prior, { runInstaller, verify: async () => verified('git') });
    expect(record.state).toBe('skipped');
    expect(record.outcome).toBe('already_present');
  });

  it('marks a fresh install as successful and installed_by_space only when verification agrees', async () => {
    const record = await executeStep(makeStep(), undefined, {
      runInstaller: async () => ({ exitCode: 0, stdout: 'Installing git...', stderr: '' }),
      verify: async () => verified('git'),
    });
    expect(record.state).toBe('successful');
    expect(record.outcome).toBe('installed_by_space');
    expect(record.changedMachineState).toBe(true);
  });

  it('marks an upgrade as updated_by_space when the tool was already present at a lower version', async () => {
    const prior: ScanToolResult = { toolId: 'git', found: true, path: '/usr/bin/git', version: '2.10.0', meetsMinimumVersion: false };
    const record = await executeStep(makeStep(), prior, {
      runInstaller: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      verify: async () => verified('git'),
    });
    expect(record.outcome).toBe('updated_by_space');
  });

  it('never treats installer exit code zero as success: fails when verification disagrees (spec section 39)', async () => {
    const record = await executeStep(makeStep(), undefined, {
      runInstaller: async () => ({ exitCode: 0, stdout: 'Installing git...', stderr: '' }),
      verify: async () => verified('git', { verified: false, failureReason: 'Executable could not be resolved.' }),
    });
    expect(record.state).toBe('failed');
    expect(record.outcome).toBe('partially_installed');
    expect(record.exitCode).toBe(0);
    expect(record.humanExplanation).toContain('Executable could not be resolved');
  });

  it('classifies a non-zero installer exit combined with failed verification as needs_manual_remediation', async () => {
    const record = await executeStep(makeStep(), undefined, {
      runInstaller: async () => ({ exitCode: 1, stdout: '', stderr: 'network unreachable' }),
      verify: async () => verified('git', { verified: false, failureReason: 'Executable could not be resolved.' }),
    });
    expect(record.state).toBe('failed');
    expect(record.outcome).toBe('needs_manual_remediation');
    expect(record.retryEligible).toBe(true);
  });

  it('reports cancellation distinctly from failure and does not run the installer', async () => {
    const runInstaller = async (): Promise<CommandExecutionResult> => {
      throw new Error('should not be called');
    };
    const record = await executeStep(makeStep(), undefined, {
      runInstaller,
      verify: async () => verified('git'),
      isCancelled: () => true,
    });
    expect(record.state).toBe('cancelled');
    expect(record.outcome).toBe('user_cancelled');
  });

  it('skips deferred-implementation steps (e.g. shell integration) without a fake success', async () => {
    const step = makeStep({ id: 'space-shell-integration', toolId: null, kind: 'shell-integration', deferredImplementation: true });
    const record = await executeStep(step, undefined, {
      runInstaller: async () => {
        throw new Error('should not be called');
      },
      verify: async () => verified('git'),
    });
    expect(record.state).toBe('skipped');
    expect(record.outcome).toBeNull();
  });

  it('redacts secrets from the captured installer output', async () => {
    const redaction = new RedactionRegistry();
    redaction.register('super-secret-token');
    const record = await executeStep(makeStep(), undefined, {
      runInstaller: async () => ({ exitCode: 0, stdout: 'auth=super-secret-token', stderr: '' }),
      verify: async () => verified('git'),
      redaction,
    });
    expect(record.redactedOutput).not.toContain('super-secret-token');
    expect(record.redactedOutput).toContain('[REDACTED]');
  });

  it('fails a step with no available strategy without attempting to run anything', async () => {
    const record = await executeStep(makeStep({ strategy: null }), undefined, {
      runInstaller: async () => {
        throw new Error('should not be called');
      },
      verify: async () => verified('git'),
    });
    expect(record.state).toBe('failed');
    expect(record.outcome).toBe('needs_manual_remediation');
  });

  it('reports needs_restart when verification says so', async () => {
    const record = await executeStep(makeStep(), undefined, {
      runInstaller: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      verify: async () => verified('git', { needsRestart: true }),
    });
    expect(record.state).toBe('needs_restart');
  });
});

describe('executePlanSteps', () => {
  it('runs every step and stops early on cancellation', async () => {
    const steps = [makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' }), makeStep({ id: 'step-3' })];
    let calls = 0;
    const records = await executePlanSteps(steps, [], {
      runInstaller: async () => {
        calls += 1;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      verify: async () => verified('git'),
      isCancelled: () => calls >= 1,
    });
    expect(records.map((r) => r.stepId)).toEqual(['step-1', 'step-2']);
    expect(records[1]?.state).toBe('cancelled');
  });

  it('continues past a failed step to attempt the remaining ones', async () => {
    const steps = [makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' })];
    const records = await executePlanSteps(steps, [], {
      runInstaller: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
      verify: async () => verified('git', { verified: false, failureReason: 'boom' }),
    });
    expect(records.map((r) => r.state)).toEqual(['failed', 'failed']);
  });
});
