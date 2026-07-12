import { HighImpactGithubActionNotConfirmedError } from '@space/domain';
import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  downloadRunArtifacts,
  fetchRunLog,
  isRunComplete,
  listRuns,
  listWorkflows,
  loadWorkflowDispatchInputs,
  pollRunUntilComplete,
  rerunRun,
  runCancelArgs,
  runDownloadArgs,
  runListArgs,
  runLogArgs,
  runRerunArgs,
  runViewArgs,
  triggerWorkflowDispatch,
  viewRun,
  workflowListArgs,
  workflowRunArgs,
} from './actions';
import type { GhExecutor } from './executor';
import type { RunDetail } from './actions';

describe('workflowListArgs / listWorkflows', () => {
  it('requests the structured field set and parses it', async () => {
    expect(workflowListArgs()).toEqual(['workflow', 'list', '--json', 'id,name,path,state']);
    const executor: GhExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ id: 1, name: 'Release', path: '.github/workflows/release.yml', state: 'active' }]),
      stderr: '',
    });
    expect(await listWorkflows(executor)).toEqual([{ id: 1, name: 'Release', path: '.github/workflows/release.yml', state: 'active' }]);
  });
});

const RELEASE_YAML = `
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version'
        required: true
        type: string
`;

describe('loadWorkflowDispatchInputs', () => {
  it('fetches and decodes the real workflow file, then parses its inputs', async () => {
    const base64 = Buffer.from(RELEASE_YAML, 'utf-8').toString('base64');
    const executor: GhExecutor = async (args) => {
      expect(args[0]).toBe('api');
      expect(args).toContain('--jq');
      return { exitCode: 0, stdout: `${base64}\n`, stderr: '' };
    };
    const inputs = await loadWorkflowDispatchInputs(executor, 'acme/widgets', '.github/workflows/release.yml');
    expect(inputs).toEqual([{ name: 'version', description: 'Version', required: true, default: null, type: 'string', options: null }]);
  });

  it('includes a ref query parameter when supplied', async () => {
    const base64 = Buffer.from(RELEASE_YAML, 'utf-8').toString('base64');
    const executor: GhExecutor = async (args) => {
      expect(args).toContain('-f');
      expect(args).toContain('ref=v1.2.3');
      return { exitCode: 0, stdout: base64, stderr: '' };
    };
    await loadWorkflowDispatchInputs(executor, 'acme/widgets', '.github/workflows/release.yml', 'v1.2.3');
  });

  it('resolves to an empty array (never invents inputs) when the file cannot be read', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 404' });
    expect(await loadWorkflowDispatchInputs(executor, 'acme/widgets', 'missing.yml')).toEqual([]);
  });
});

describe('runListArgs / listRuns', () => {
  it('builds filters and a default limit', () => {
    const args = runListArgs({ workflow: 'release.yml', branch: 'main', limit: 5 });
    expect(args).toContain('--workflow');
    expect(args).toContain('release.yml');
    expect(args).toContain('--branch');
    expect(args[args.length - 1]).toBe('5');
  });
});

describe('workflowRunArgs / triggerWorkflowDispatch', () => {
  it('builds ref plus -f input flags', () => {
    expect(workflowRunArgs({ workflow: 'release.yml', ref: 'main', inputs: { version: '1.2.3', dry_run: 'false' } })).toEqual([
      'workflow',
      'run',
      'release.yml',
      '--ref',
      'main',
      '-f',
      'version=1.2.3',
      '-f',
      'dry_run=false',
    ]);
  });

  it('refuses to trigger without confirmation and never calls gh', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(triggerWorkflowDispatch(executor, { workflow: 'release.yml', ref: 'main', confirmed: false })).rejects.toThrow(
      HighImpactGithubActionNotConfirmedError,
    );
    expect(called).toBe(false);
  });

  it('triggers for real once confirmed', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['workflow', 'run', 'release.yml', '--ref', 'main']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(triggerWorkflowDispatch(executor, { workflow: 'release.yml', ref: 'main', confirmed: true })).resolves.toBeUndefined();
  });
});

const RUN_FIXTURE: RunDetail = {
  databaseId: 100,
  name: 'Release',
  displayTitle: 'Release v1.2.3',
  status: 'in_progress',
  conclusion: null,
  workflowName: 'Release',
  headBranch: 'main',
  event: 'workflow_dispatch',
  createdAt: '2026-07-12T10:00:00Z',
  url: 'https://github.com/acme/widgets/actions/runs/100',
  jobs: [{ name: 'build', status: 'in_progress', conclusion: null }],
};

describe('runViewArgs / viewRun / isRunComplete', () => {
  it('requests the detail field set including jobs', () => {
    expect(runViewArgs(100).join(' ')).toContain('jobs');
  });

  it('parses the run detail', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(RUN_FIXTURE), stderr: '' });
    expect(await viewRun(executor, 100)).toEqual(RUN_FIXTURE);
  });

  it('treats completed/cancelled/failure as terminal', () => {
    expect(isRunComplete({ status: 'in_progress' })).toBe(false);
    expect(isRunComplete({ status: 'completed' })).toBe(true);
    expect(isRunComplete({ status: 'cancelled' })).toBe(true);
  });
});

describe('pollRunUntilComplete', () => {
  it('polls with backoff until the run completes', async () => {
    const inProgress = RUN_FIXTURE;
    const done = { ...RUN_FIXTURE, status: 'completed', conclusion: 'success' };
    let call = 0;
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(call++ === 0 ? inProgress : done), stderr: '' });
    const sleeps: number[] = [];
    const result = await pollRunUntilComplete(executor, 100, {
      isCancelled: () => false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      backoffMs: [5, 10],
    });
    expect(result.stoppedReason).toBe('complete');
    expect(result.run?.status).toBe('completed');
    expect(sleeps).toEqual([5]);
  });

  it('stops immediately when the view is closed', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: JSON.stringify(RUN_FIXTURE), stderr: '' };
    };
    const result = await pollRunUntilComplete(executor, 100, { isCancelled: () => true, sleep: async () => {} });
    expect(result.stoppedReason).toBe('cancelled');
    expect(called).toBe(false);
  });
});

describe('fetchRunLog', () => {
  it('returns the raw log text', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(runLogArgs(100));
      return { exitCode: 0, stdout: 'build\tstep1\thello\n', stderr: '' };
    };
    expect(await fetchRunLog(executor, 100)).toBe('build\tstep1\thello\n');
  });
});

describe('downloadRunArtifacts / cancelRun / rerunRun', () => {
  it('builds download args with an optional artifact name', () => {
    expect(runDownloadArgs(100, '/tmp/out')).toEqual(['run', 'download', '100', '--dir', '/tmp/out']);
    expect(runDownloadArgs(100, '/tmp/out', 'build-output')).toEqual(['run', 'download', '100', '--dir', '/tmp/out', '--name', 'build-output']);
  });

  it('runs download/cancel/rerun for real through the injected executor', async () => {
    const calls: string[][] = [];
    const executor: GhExecutor = async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await downloadRunArtifacts(executor, 100, '/tmp/out');
    await cancelRun(executor, 100);
    await rerunRun(executor, 100, true);
    expect(calls[0]).toEqual(['run', 'download', '100', '--dir', '/tmp/out']);
    expect(calls[1]).toEqual(runCancelArgs(100));
    expect(calls[2]).toEqual(runRerunArgs(100, true));
  });
});
