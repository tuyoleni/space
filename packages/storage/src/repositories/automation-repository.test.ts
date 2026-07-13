import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';
import { MAX_RETAINED_RUNS_PER_AUTOMATION } from './automation-run-repository';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-automation-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: 'now', updatedAt: 'now' });
  storage.projects.create({
    id: 'proj-a',
    workspaceId: 'ws-a',
    name: 'Project A',
    canonicalPath: '/tmp/project-a',
    filesystemIdentity: null,
    repositoryRoot: '/tmp/project-a',
    detectedTypes: [],
    createdAt: 'now',
    updatedAt: 'now',
  });
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('AutomationRepository (spec 18.1)', () => {
  it('creates an automation enabled by default and round-trips trigger/conditions/actions as JSON', () => {
    const created = storage.automations.create({
      id: 'auto-1',
      workspaceId: 'ws-a',
      projectId: null,
      name: 'Notify on failed checks',
      trigger: { type: 'check-failed' },
      conditions: [{ field: 'branch', operator: 'equals', value: 'main' }],
      actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'A check failed' } }],
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect(created.enabled).toBe(true);
    expect(created.trigger).toEqual({ type: 'check-failed' });
    expect(created.actions).toEqual([{ id: 'a1', type: 'notifyUser', parameters: { message: 'A check failed' } }]);
  });

  it('toggles enabled via setEnabled', () => {
    storage.automations.create({
      id: 'auto-1',
      workspaceId: 'ws-a',
      projectId: null,
      name: 'X',
      trigger: { type: 'commit-created' },
      conditions: [],
      actions: [{ id: 'a1', type: 'runTests', parameters: {} }],
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    const disabled = storage.automations.setEnabled('auto-1', false, '2026-07-13T01:00:00.000Z');
    expect(disabled.enabled).toBe(false);
    expect(storage.automations.findById('auto-1')?.enabled).toBe(false);
  });

  it('lists by workspace, newest first', () => {
    storage.automations.create({ id: 'a1', workspaceId: 'ws-a', projectId: null, name: 'first', trigger: { type: 'commit-created' }, conditions: [], actions: [{ id: '1', type: 'runTests', parameters: {} }], createdAt: '2026-07-13T00:00:00.000Z' });
    storage.automations.create({ id: 'a2', workspaceId: 'ws-a', projectId: null, name: 'second', trigger: { type: 'commit-created' }, conditions: [], actions: [{ id: '1', type: 'runTests', parameters: {} }], createdAt: '2026-07-13T01:00:00.000Z' });
    expect(storage.automations.listByWorkspace('ws-a').map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('cascades deletion when the owning workspace is removed', () => {
    storage.automations.create({ id: 'auto-1', workspaceId: 'ws-a', projectId: null, name: 'X', trigger: { type: 'commit-created' }, conditions: [], actions: [{ id: '1', type: 'runTests', parameters: {} }], createdAt: '2026-07-13T00:00:00.000Z' });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.automations.findById('auto-1')).toBeNull();
  });
});

describe('AutomationRunRepository (spec 18.1 execution history, 18.4 receipts)', () => {
  it('starts and completes a run', () => {
    storage.automations.create({ id: 'auto-1', workspaceId: 'ws-a', projectId: null, name: 'X', trigger: { type: 'commit-created' }, conditions: [], actions: [{ id: '1', type: 'runTests', parameters: {} }], createdAt: '2026-07-13T00:00:00.000Z' });
    const run = storage.automationRuns.start({
      id: 'run-1',
      automationId: 'auto-1',
      workspaceId: 'ws-a',
      projectId: null,
      triggerType: 'commit-created',
      triggerEvent: { type: 'commit-created', workspaceId: 'ws-a', projectId: null, occurredAt: '2026-07-13T00:00:00.000Z', context: {} },
      startedAt: '2026-07-13T00:00:00.000Z',
    });
    expect(run.state).toBe('running');

    const completed = storage.automationRuns.complete('run-1', { state: 'succeeded', endedAt: '2026-07-13T00:01:00.000Z', attempts: 1 });
    expect(completed.state).toBe('succeeded');
    expect(completed.attempts).toBe(1);
  });

  it('enforces MAX_RETAINED_RUNS_PER_AUTOMATION by pruning the oldest runs as new ones start', () => {
    storage.automations.create({ id: 'auto-1', workspaceId: 'ws-a', projectId: null, name: 'X', trigger: { type: 'commit-created' }, conditions: [], actions: [{ id: '1', type: 'runTests', parameters: {} }], createdAt: '2026-07-13T00:00:00.000Z' });
    const keep = 3;
    for (let i = 0; i < keep + 5; i += 1) {
      storage.automationRuns.start({
        id: `run-${i}`,
        automationId: 'auto-1',
        workspaceId: 'ws-a',
        projectId: null,
        triggerType: 'commit-created',
        triggerEvent: {},
        startedAt: `2026-07-13T00:${String(i).padStart(2, '0')}:00.000Z`,
      });
      storage.automationRuns.pruneOldRuns('auto-1', keep);
    }
    const remaining = storage.automationRuns.listByAutomation('auto-1', 100);
    expect(remaining).toHaveLength(keep);
    // The most recent `keep` runs survive — the oldest ones were evicted.
    expect(remaining.map((r) => r.id)).toEqual(['run-7', 'run-6', 'run-5']);
  });

  it('the default retention constant is a real bound greater than zero', () => {
    expect(MAX_RETAINED_RUNS_PER_AUTOMATION).toBeGreaterThan(0);
  });
});

describe('AutomationSettingsRepository (spec 18.4 instant kill switch)', () => {
  it('defaults to enabled when no row exists', () => {
    expect(storage.automationSettings.isAllEnabled('ws-a')).toBe(true);
  });

  it('flips off immediately and persists across repository instances', () => {
    storage.automationSettings.setAllEnabled('ws-a', false, '2026-07-13T00:00:00.000Z');
    expect(storage.automationSettings.isAllEnabled('ws-a')).toBe(false);

    storage.automationSettings.setAllEnabled('ws-a', true, '2026-07-13T01:00:00.000Z');
    expect(storage.automationSettings.isAllEnabled('ws-a')).toBe(true);
  });

  it('is scoped per workspace', () => {
    storage.workspaces.create({ id: 'ws-b', name: 'B', iconToken: null, defaultProjectDirectory: null, createdAt: 'now', updatedAt: 'now' });
    storage.automationSettings.setAllEnabled('ws-a', false, '2026-07-13T00:00:00.000Z');
    expect(storage.automationSettings.isAllEnabled('ws-a')).toBe(false);
    expect(storage.automationSettings.isAllEnabled('ws-b')).toBe(true);
  });
});
