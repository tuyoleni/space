import { describe, expect, it } from 'vitest';
import {
  allChecksComplete,
  anyCheckFailing,
  deriveRequiredCheckStatus,
  loadChecks,
  loadRequiredCheckNames,
  pollChecksUntilComplete,
  prChecksArgs,
} from './checks';
import type { GhExecutor } from './executor';
import type { CheckRun } from './checks';

const PASSING: CheckRun = { name: 'build', state: 'SUCCESS', workflow: 'CI', startedAt: 't0', completedAt: 't1', link: 'https://x/1', bucket: 'pass' };
const FAILING: CheckRun = { name: 'lint', state: 'FAILURE', workflow: 'CI', startedAt: 't0', completedAt: 't1', link: 'https://x/2', bucket: 'fail' };
const PENDING: CheckRun = { name: 'e2e', state: 'IN_PROGRESS', workflow: 'CI', startedAt: 't0', completedAt: null, link: 'https://x/3', bucket: 'pending' };

describe('prChecksArgs', () => {
  it('requests the structured field set', () => {
    expect(prChecksArgs(42)).toEqual(['pr', 'checks', '42', '--json', 'name,state,startedAt,completedAt,link,bucket,workflow']);
  });
});

describe('loadChecks', () => {
  it('parses JSON even when gh exits non-zero because a check is failing', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 8, stdout: JSON.stringify([PASSING, FAILING]), stderr: '' });
    expect(await loadChecks(executor, 42)).toEqual([PASSING, FAILING]);
  });

  it('returns an empty array when there are no checks yet', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' });
    expect(await loadChecks(executor, 42)).toEqual([]);
  });

  it('throws on a real failure with no JSON body', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'no pull requests found' });
    await expect(loadChecks(executor, 42)).rejects.toThrow(/no pull requests found/);
  });
});

describe('allChecksComplete / anyCheckFailing', () => {
  it('is false while any check is pending', () => {
    expect(allChecksComplete([PASSING, PENDING])).toBe(false);
  });

  it('is true once every check reaches a terminal bucket, including failures', () => {
    expect(allChecksComplete([PASSING, FAILING])).toBe(true);
    expect(anyCheckFailing([PASSING, FAILING])).toBe(true);
  });

  it('is false for an empty check list (nothing has reported yet)', () => {
    expect(allChecksComplete([])).toBe(false);
  });
});

describe('loadRequiredCheckNames', () => {
  it('parses the branch protection required contexts', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args[1]).toBe('repos/acme/widgets/branches/main/protection');
      return { exitCode: 0, stdout: JSON.stringify(['build', 'lint']), stderr: '' };
    };
    expect(await loadRequiredCheckNames(executor, 'acme/widgets', 'main')).toEqual(['build', 'lint']);
  });

  it('resolves to null (not obtainable) on an unprotected branch 404', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 404: Branch not protected' });
    expect(await loadRequiredCheckNames(executor, 'acme/widgets', 'main')).toBeNull();
  });
});

describe('deriveRequiredCheckStatus', () => {
  it('reports missing required checks that have not passed', () => {
    const status = deriveRequiredCheckStatus([PASSING, PENDING], ['build', 'e2e']);
    expect(status).toEqual({ requiredNames: ['build', 'e2e'], missing: ['e2e'], allRequiredPassing: false });
  });

  it('is passing when required names is null (nothing is required, or not obtainable)', () => {
    expect(deriveRequiredCheckStatus([PASSING], null)).toEqual({ requiredNames: [], missing: [], allRequiredPassing: true });
  });
});

describe('pollChecksUntilComplete', () => {
  it('polls with backoff until all checks are terminal, sleeping between attempts', async () => {
    const responses: CheckRun[][] = [[PENDING], [PENDING], [PASSING]];
    let call = 0;
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(responses[call++]), stderr: '' });
    const sleeps: number[] = [];
    const result = await pollChecksUntilComplete(executor, 42, {
      isCancelled: () => false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      backoffMs: [10, 20, 40],
    });
    expect(result.stoppedReason).toBe('complete');
    expect(result.checks).toEqual([PASSING]);
    expect(result.attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('stops immediately when the view is already closed, without calling gh', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: JSON.stringify([PENDING]), stderr: '' };
    };
    const result = await pollChecksUntilComplete(executor, 42, { isCancelled: () => true, sleep: async () => {} });
    expect(result.stoppedReason).toBe('cancelled');
    expect(called).toBe(false);
  });

  it('stops after maxAttempts rather than polling forever on a stuck check', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify([PENDING]), stderr: '' });
    const result = await pollChecksUntilComplete(executor, 42, {
      isCancelled: () => false,
      sleep: async () => {},
      maxAttempts: 3,
      backoffMs: [1],
    });
    expect(result.stoppedReason).toBe('max-attempts');
    expect(result.attempts).toBe(3);
  });

  it('stops between fetch and sleep once the view closes mid-poll', async () => {
    let call = 0;
    const executor: GhExecutor = async () => {
      call += 1;
      return { exitCode: 0, stdout: JSON.stringify([PENDING]), stderr: '' };
    };
    const result = await pollChecksUntilComplete(executor, 42, {
      isCancelled: () => call >= 1,
      sleep: async () => {
        throw new Error('should not sleep once cancelled');
      },
      backoffMs: [1],
    });
    expect(result.stoppedReason).toBe('cancelled');
    expect(call).toBe(1);
  });
});
