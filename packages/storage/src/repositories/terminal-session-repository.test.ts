import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';

let dir: string;
let storage: Storage;
let workspaceId: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-terminal-repo-'));
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
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('TerminalSessionRepository (spec sections 15.4, 23.2.3)', () => {
  it('creates a session running by default and re-reads it', () => {
    const now = new Date().toISOString();
    const session = storage.terminalSessions.create({
      id: 'term-1',
      workspaceId,
      projectId: null,
      shell: '/bin/zsh',
      cwd: '/tmp',
      pid: 4242,
      startedAt: now,
    });
    expect(session.state).toBe('running');
    expect(session.pid).toBe(4242);
    expect(session.endedAt).toBeNull();
    expect(storage.terminalSessions.findById('term-1')?.id).toBe('term-1');
  });

  it('lists sessions scoped to a workspace, ordered by start time', () => {
    const now = new Date().toISOString();
    storage.terminalSessions.create({ id: 'a', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 1, startedAt: now });
    storage.terminalSessions.create({ id: 'b', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 2, startedAt: now });
    expect(storage.terminalSessions.listByWorkspace(workspaceId).map((s) => s.id)).toEqual(['a', 'b']);
    expect(storage.terminalSessions.listByWorkspace('does-not-exist')).toEqual([]);
  });

  it('records last output time without touching other fields', () => {
    const now = new Date().toISOString();
    storage.terminalSessions.create({ id: 'a', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 1, startedAt: now });
    const outputTime = new Date(Date.now() + 1000).toISOString();
    storage.terminalSessions.recordOutput('a', outputTime);
    expect(storage.terminalSessions.findById('a')?.lastOutputAt).toBe(outputTime);
  });

  it('marks a session exited with its exit code', () => {
    const now = new Date().toISOString();
    storage.terminalSessions.create({ id: 'a', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 1, startedAt: now });
    const ended = storage.terminalSessions.markExited('a', 0, new Date().toISOString());
    expect(ended.state).toBe('exited');
    expect(ended.exitCode).toBe(0);
    expect(ended.endedAt).not.toBeNull();
  });

  it('reconcileOrphanedSessions marks every running session exited and leaves exited ones alone', () => {
    const now = new Date().toISOString();
    storage.terminalSessions.create({ id: 'a', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 1, startedAt: now });
    storage.terminalSessions.create({ id: 'b', workspaceId, projectId: null, shell: 'zsh', cwd: '/tmp', pid: 2, startedAt: now });
    storage.terminalSessions.markExited('b', 1, now);

    const changed = storage.terminalSessions.reconcileOrphanedSessions(new Date().toISOString());
    expect(changed).toBe(1);
    expect(storage.terminalSessions.findById('a')?.state).toBe('exited');
    expect(storage.terminalSessions.findById('a')?.exitCode).toBeNull();
    expect(storage.terminalSessions.findById('b')?.exitCode).toBe(1);
  });
});
