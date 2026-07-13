/**
 * M8: `createAutomationHandlers`'s `runDueScheduledAutomations` exercised
 * end to end against a real temp-directory SQLite database (via
 * `handleStorageRequest`, the same code path the storage worker runs —
 * mirrors m4-project-handlers.test.ts), proving the `scheduled` trigger
 * (spec 18.2) actually fires through the real storage-backed due-check
 * (`isScheduledAutomationDue`) and the real `AutomationEngine`, not just a
 * unit-level fake. `gitHandlers`/`githubHandlers` are narrow structural
 * fakes here — this test only exercises the `notifyUser` action, which
 * never calls either — matching every other cross-boundary test in this
 * codebase's "local-fixture/fake only, never a real remote" rule.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@space/contracts';
import { createStorage, type Storage } from '@space/storage';
import { createAutomationHandlers } from '../../apps/desktop/src/main/automation-handlers';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import type { StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';
import type { GitHandlers } from '../../apps/desktop/src/main/git-handlers';
import type { GithubHandlers } from '../../apps/desktop/src/main/github-handlers';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m8-scheduling-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storageCaller = {
    call: <T>(method: StorageMethod, payload: unknown) => {
      requestSequence += 1;
      return handleStorageRequest(storage, { id: `req-${requestSequence}`, method, payload }) as Promise<T>;
    },
  };
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeWorkspace(name = 'A'): Promise<Workspace> {
  return storageCaller.call<Workspace>('workspace.create', { name });
}

function buildHandlers(notify: (message: string) => void) {
  // Never called by the `notifyUser` action this test exercises — narrow
  // structural fakes so this test never touches a real Git/GitHub
  // executor, matching the "local-fixture/fake only" rule for anything
  // that could otherwise reach a real remote.
  const gitHandlers = {} as GitHandlers;
  const githubHandlers = {} as GithubHandlers;
  const projectHandlers = { detectPackageManager: async () => ({ packageManager: null }) };
  return createAutomationHandlers(storageCaller, { gitHandlers, githubHandlers, projectHandlers, notify });
}

describe('runDueScheduledAutomations (M8 spec 18.2 "scheduled" trigger)', () => {
  it('runs a never-before-run scheduled automation immediately, and writes a succeeded receipt', async () => {
    const workspace = await makeWorkspace();
    const delivered: string[] = [];
    const handlers = buildHandlers((message) => delivered.push(message));

    await handlers.createAutomation({
      workspaceId: workspace.id,
      projectId: null,
      name: 'Hourly ping',
      trigger: { type: 'scheduled', intervalMinutes: 60 },
      conditions: [],
      actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'tick' } }],
    });

    const results = await handlers.runDueScheduledAutomations(new Date('2026-01-01T00:00:00.000Z'));
    expect(results).toHaveLength(1);
    expect(results[0]?.state).toBe('succeeded');
    expect(delivered).toEqual(['tick']);
  });

  it('does not re-run before the interval elapses, but does once it has', async () => {
    const workspace = await makeWorkspace();
    const delivered: string[] = [];
    const handlers = buildHandlers((message) => delivered.push(message));

    await handlers.createAutomation({
      workspaceId: workspace.id,
      projectId: null,
      name: 'Every 30 minutes',
      trigger: { type: 'scheduled', intervalMinutes: 30 },
      conditions: [],
      actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'tick' } }],
    });

    const first = await handlers.runDueScheduledAutomations(new Date('2026-01-01T00:00:00.000Z'));
    expect(first).toHaveLength(1);

    const tooSoon = await handlers.runDueScheduledAutomations(new Date('2026-01-01T00:10:00.000Z'));
    expect(tooSoon).toHaveLength(0);

    const dueAgain = await handlers.runDueScheduledAutomations(new Date('2026-01-01T00:30:00.000Z'));
    expect(dueAgain).toHaveLength(1);
    expect(delivered).toEqual(['tick', 'tick']);
  });

  it('never runs a disabled automation, and never runs a non-scheduled-trigger automation from this entry point', async () => {
    const workspace = await makeWorkspace();
    const handlers = buildHandlers(() => undefined);

    const disabled = await handlers.createAutomation({
      workspaceId: workspace.id,
      projectId: null,
      name: 'Disabled scheduled',
      trigger: { type: 'scheduled', intervalMinutes: 1 },
      conditions: [],
      actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'x' } }],
    });
    await handlers.setEnabled(disabled.id, false);

    await handlers.createAutomation({
      workspaceId: workspace.id,
      projectId: null,
      name: 'Commit-triggered, not scheduled',
      trigger: { type: 'commit-created' },
      conditions: [],
      actions: [{ id: 'a1', type: 'notifyUser', parameters: { message: 'x' } }],
    });

    const results = await handlers.runDueScheduledAutomations(new Date('2026-01-01T00:00:00.000Z'));
    expect(results).toHaveLength(0);
  });
});
