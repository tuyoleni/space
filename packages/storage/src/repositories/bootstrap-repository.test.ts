import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';

let dir: string;
let dbPath: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-bootstrap-repo-'));
  dbPath = path.join(dir, 'space.sqlite');
  storage = createStorage(dbPath);
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('BootstrapRepository (spec section 8, ONB-001/006/008)', () => {
  it('creates a run defaulting to not_started and re-reads it', () => {
    const now = new Date().toISOString();
    const run = storage.bootstrap.createRun({
      id: 'run-1',
      status: 'not_started',
      platform: 'darwin',
      createdAt: now,
      updatedAt: now,
    });
    expect(run.status).toBe('not_started');
    expect(run.planJson).toBeNull();
    expect(run.blockReason).toBeNull();
    expect(storage.bootstrap.findRunById('run-1')?.id).toBe('run-1');
  });

  it('findRunById and getLatestRun return null when nothing exists', () => {
    expect(storage.bootstrap.findRunById('nope')).toBeNull();
    expect(storage.bootstrap.getLatestRun()).toBeNull();
  });

  it('getLatestRun returns the most recently created run, enabling resume-after-restart', () => {
    storage.bootstrap.createRun({
      id: 'run-1',
      status: 'complete',
      platform: 'darwin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    storage.bootstrap.createRun({
      id: 'run-2',
      status: 'installing',
      platform: 'darwin',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(storage.bootstrap.getLatestRun()?.id).toBe('run-2');
  });

  it('updateStatus transitions status and records a block reason', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'not_started', platform: 'darwin', createdAt: now, updatedAt: now });
    storage.bootstrap.updateStatus('run-1', 'scanning', now);
    expect(storage.bootstrap.findRunById('run-1')?.status).toBe('scanning');

    storage.bootstrap.updateStatus('run-1', 'blocked', now, 'macOS version unsupported');
    const blocked = storage.bootstrap.findRunById('run-1');
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockReason).toBe('macOS version unsupported');
  });

  it('updateStatus throws for an unknown run', () => {
    expect(() => storage.bootstrap.updateStatus('does-not-exist', 'scanning', new Date().toISOString())).toThrow();
  });

  it('savePlan round-trips an arbitrary JSON plan', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'plan_ready', platform: 'darwin', createdAt: now, updatedAt: now });
    const plan = { platform: 'darwin', steps: [{ toolId: 'git', kind: 'tool-install' }] };
    storage.bootstrap.savePlan('run-1', plan, now);
    expect(storage.bootstrap.findRunById('run-1')?.planJson).toEqual(plan);
  });

  it('upsertStep inserts steps and listSteps orders by sequence', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'installing', platform: 'darwin', createdAt: now, updatedAt: now });

    storage.bootstrap.upsertStep({
      id: 'step-git',
      runId: 'run-1',
      sequence: 1,
      toolId: 'git',
      state: 'pending',
      humanExplanation: 'Install Git via Homebrew',
      commandDisplayRedacted: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: null,
      operationId: null,
    });
    storage.bootstrap.upsertStep({
      id: 'step-homebrew',
      runId: 'run-1',
      sequence: 0,
      toolId: null,
      state: 'successful',
      humanExplanation: 'Homebrew already present',
      commandDisplayRedacted: null,
      startedAt: now,
      endedAt: now,
      exitCode: 0,
      redactedOutput: '',
      retryEligible: false,
      changedMachineState: false,
      outcome: 'already_present',
      operationId: null,
    });

    const steps = storage.bootstrap.listSteps('run-1');
    expect(steps.map((s) => s.id)).toEqual(['step-homebrew', 'step-git']);
    expect(steps[0]?.outcome).toBe('already_present');
  });

  it('upsertStep on an existing (run_id, sequence) overwrites the prior record (retry/resume)', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'installing', platform: 'darwin', createdAt: now, updatedAt: now });

    storage.bootstrap.upsertStep({
      id: 'step-git-attempt-1',
      runId: 'run-1',
      sequence: 0,
      toolId: 'git',
      state: 'failed',
      humanExplanation: 'Install Git via Homebrew',
      commandDisplayRedacted: 'brew install git',
      startedAt: now,
      endedAt: now,
      exitCode: 1,
      redactedOutput: 'network error',
      retryEligible: true,
      changedMachineState: false,
      outcome: 'needs_manual_remediation',
      operationId: null,
    });

    storage.bootstrap.upsertStep({
      id: 'step-git-attempt-2',
      runId: 'run-1',
      sequence: 0,
      toolId: 'git',
      state: 'successful',
      humanExplanation: 'Install Git via Homebrew (retry)',
      commandDisplayRedacted: 'brew install git',
      startedAt: now,
      endedAt: now,
      exitCode: 0,
      redactedOutput: '',
      retryEligible: false,
      changedMachineState: true,
      outcome: 'installed_by_space',
      operationId: null,
    });

    const steps = storage.bootstrap.listSteps('run-1');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.id).toBe('step-git-attempt-2');
    expect(steps[0]?.state).toBe('successful');
    expect(steps[0]?.outcome).toBe('installed_by_space');
  });

  it('cascades step deletion when the owning run is removed', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'installing', platform: 'darwin', createdAt: now, updatedAt: now });
    storage.bootstrap.upsertStep({
      id: 'step-git',
      runId: 'run-1',
      sequence: 0,
      toolId: 'git',
      state: 'pending',
      humanExplanation: 'Install Git',
      commandDisplayRedacted: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: false,
      outcome: null,
      operationId: null,
    });
    storage.db.prepare('DELETE FROM bootstrap_runs WHERE id = ?').run('run-1');
    expect(storage.bootstrap.listSteps('run-1')).toHaveLength(0);
  });

  it('sets operation_id to NULL (not cascading the step) when the linked operation is removed', () => {
    const now = new Date().toISOString();
    storage.bootstrap.createRun({ id: 'run-1', status: 'installing', platform: 'darwin', createdAt: now, updatedAt: now });
    storage.operations.start({
      id: 'op-1',
      workspaceId: null,
      projectId: null,
      type: 'bootstrap.install',
      risk: 'local-reversible',
      humanSummary: 'Install Git',
      startedAt: now,
    });
    storage.bootstrap.upsertStep({
      id: 'step-git',
      runId: 'run-1',
      sequence: 0,
      toolId: 'git',
      state: 'successful',
      humanExplanation: 'Install Git',
      commandDisplayRedacted: null,
      startedAt: now,
      endedAt: now,
      exitCode: 0,
      redactedOutput: null,
      retryEligible: false,
      changedMachineState: true,
      outcome: 'installed_by_space',
      operationId: 'op-1',
    });
    storage.db.prepare('DELETE FROM operations WHERE id = ?').run('op-1');
    expect(storage.bootstrap.listSteps('run-1')[0]?.operationId).toBeNull();
  });
});
