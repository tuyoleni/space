import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';

let dir: string;
let storage: Storage;
let workspaceId: string;
let projectId: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-devprocess-repo-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  const now = new Date().toISOString();
  const ws = storage.workspaces.create({
    id: 'ws-1',
    name: 'A',
    iconToken: null,
    defaultProjectDirectory: null,
    createdAt: now,
    updatedAt: now,
  });
  workspaceId = ws.id;
  const project = storage.projects.create({
    id: 'proj-1',
    workspaceId,
    name: 'demo',
    canonicalPath: '/tmp/demo',
    filesystemIdentity: null,
    repositoryRoot: null,
    detectedTypes: ['node'],
    createdAt: now,
    updatedAt: now,
  });
  projectId = project.id;
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('DevProcessRepository (PRJ-006, spec section 10.6)', () => {
  it('creates a process running by default with no URL yet', () => {
    const now = new Date().toISOString();
    const record = storage.devProcesses.create({
      id: 'dev-1',
      workspaceId,
      projectId,
      commandDisplay: 'npm run dev',
      cwd: '/tmp/demo',
      pid: 999,
      startedAt: now,
      operationId: null,
    });
    expect(record.state).toBe('running');
    expect(record.detectedUrl).toBeNull();
  });

  it('records a detected URL once observed in process output', () => {
    const now = new Date().toISOString();
    storage.devProcesses.create({
      id: 'dev-1',
      workspaceId,
      projectId,
      commandDisplay: 'npm run dev',
      cwd: '/tmp/demo',
      pid: 999,
      startedAt: now,
      operationId: null,
    });
    const updated = storage.devProcesses.setDetectedUrl('dev-1', 'http://localhost:5173');
    expect(updated.detectedUrl).toBe('http://localhost:5173');
  });

  it('lists processes scoped to a project, most recent first', () => {
    const now = new Date().toISOString();
    storage.devProcesses.create({ id: 'a', workspaceId, projectId, commandDisplay: 'npm run dev', cwd: '/tmp', pid: 1, startedAt: now, operationId: null });
    const later = new Date(Date.now() + 1000).toISOString();
    storage.devProcesses.create({ id: 'b', workspaceId, projectId, commandDisplay: 'npm run dev', cwd: '/tmp', pid: 2, startedAt: later, operationId: null });
    expect(storage.devProcesses.listByProject(projectId).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('marks a process stopped or crashed with an exit code', () => {
    const now = new Date().toISOString();
    storage.devProcesses.create({ id: 'a', workspaceId, projectId, commandDisplay: 'npm run dev', cwd: '/tmp', pid: 1, startedAt: now, operationId: null });
    const stopped = storage.devProcesses.markStopped('a', 'stopped', 0, new Date().toISOString());
    expect(stopped.state).toBe('stopped');
    expect(stopped.exitCode).toBe(0);
  });

  it('reconcileOrphanedProcesses stops every running process left over from a prior app run', () => {
    const now = new Date().toISOString();
    storage.devProcesses.create({ id: 'a', workspaceId, projectId, commandDisplay: 'npm run dev', cwd: '/tmp', pid: 1, startedAt: now, operationId: null });
    const changed = storage.devProcesses.reconcileOrphanedProcesses(new Date().toISOString());
    expect(changed).toBe(1);
    expect(storage.devProcesses.findById('a')?.state).toBe('stopped');
  });
});
