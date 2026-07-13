import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from './storage';
import { backupDatabaseFile, runMigrations, type Migration } from './migrations';
import { withReceipt } from './receipts';

function makeWorkspace(storage: Storage, id: string, name = id) {
  const now = new Date().toISOString();
  return storage.workspaces.create({
    id,
    name,
    iconToken: null,
    defaultProjectDirectory: null,
    createdAt: now,
    updatedAt: now,
  });
}

function makeProject(storage: Storage, id: string, workspaceId: string, canonicalPath: string) {
  const now = new Date().toISOString();
  return storage.projects.create({
    id,
    workspaceId,
    name: id,
    canonicalPath,
    filesystemIdentity: null,
    repositoryRoot: null,
    detectedTypes: ['node'],
    createdAt: now,
    updatedAt: now,
  });
}

let dir: string;
let dbPath: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-storage-'));
  dbPath = path.join(dir, 'space.sqlite');
  storage = createStorage(dbPath);
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrations (spec section 23.3)', () => {
  it('applies migrations exactly once, even across reopen', () => {
    storage.close();
    const db = createStorage(dbPath);
    const result = runMigrations(db.db, dbPath);
    expect(result.appliedCount).toBe(0);
    db.close();
  });

  it('creates a backup file before applying a pending migration on an existing db', () => {
    storage.close();
    const backup = backupDatabaseFile(dbPath);
    expect(backup).not.toBeNull();
    expect(fs.existsSync(backup as string)).toBe(true);
  });

  it('returns null from backupDatabaseFile when the db file does not exist yet', () => {
    const freshPath = path.join(dir, 'never-created.sqlite');
    expect(backupDatabaseFile(freshPath)).toBeNull();
  });

  it('rolls back and throws on a failing migration, leaving prior versions applied', () => {
    storage.close();
    const db = createStorage(dbPath);
    const migrations: readonly Migration[] = [
      { version: 1, name: 'init', sql: '' }, // already applied, filtered out
      { version: 2, name: 'bootstrap', sql: '' }, // already applied, filtered out
      { version: 3, name: 'terminal_and_dev_process', sql: '' }, // already applied, filtered out
      { version: 4, name: 'activity', sql: '' }, // already applied, filtered out
      { version: 5, name: 'github', sql: '' }, // already applied, filtered out
      { version: 6, name: 'agent', sql: '' }, // already applied, filtered out
      { version: 7, name: 'automation', sql: '' }, // already applied, filtered out
      { version: 8, name: 'app_settings', sql: '' }, // already applied, filtered out
      { version: 9, name: 'ok', sql: 'CREATE TABLE ok_table (id TEXT PRIMARY KEY);' },
      { version: 10, name: 'broken', sql: 'CREATE TABLE this is not valid sql;' },
    ];

    expect(() => runMigrations(db.db, dbPath, migrations)).toThrow(/Migration 10.*rolled back/);

    // version 9 committed (its own transaction succeeded before version 10 failed)
    const applied = db.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
      version: number;
    }>;
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(
      db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ok_table'").get(),
    ).toBeTruthy();
    db.close();
  });
});

describe('WorkspaceRepository (spec section 9)', () => {
  it('creates workspaces with a stable id and lists them in creation order', () => {
    const now = new Date().toISOString();
    const a = storage.workspaces.create({
      id: 'ws-a',
      name: 'Client A',
      iconToken: null,
      defaultProjectDirectory: null,
      createdAt: now,
      updatedAt: now,
    });
    const b = storage.workspaces.create({
      id: 'ws-b',
      name: 'Client B',
      iconToken: null,
      defaultProjectDirectory: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(a.id).toBe('ws-a');
    expect(storage.workspaces.list().map((w) => w.id)).toEqual(['ws-a', 'ws-b']);
    expect(b.active).toBe(false);
  });

  it('activate() switches the active workspace atomically (WS-006)', () => {
    const now = new Date().toISOString();
    storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });
    storage.workspaces.create({ id: 'ws-b', name: 'B', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });

    storage.workspaces.activate('ws-a', new Date().toISOString());
    expect(storage.workspaces.list().find((w) => w.id === 'ws-a')?.active).toBe(true);
    expect(storage.workspaces.list().find((w) => w.id === 'ws-b')?.active).toBe(false);

    storage.workspaces.activate('ws-b', new Date().toISOString());
    const rows = storage.workspaces.list();
    expect(rows.filter((w) => w.active)).toHaveLength(1);
    expect(rows.find((w) => w.id === 'ws-b')?.active).toBe(true);
  });

  it('rejects activating an unknown workspace without corrupting state', () => {
    const now = new Date().toISOString();
    storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });
    storage.workspaces.activate('ws-a', now);
    expect(() => storage.workspaces.activate('does-not-exist', now)).toThrow();
    expect(storage.workspaces.list().find((w) => w.id === 'ws-a')?.active).toBe(true);
  });

  it('findById returns null for an unknown workspace and list() returns [] when empty', () => {
    expect(storage.workspaces.findById('nope')).toBeNull();
    expect(storage.workspaces.list()).toEqual([]);
  });

  it('new workspaces default to inactive', () => {
    const ws = makeWorkspace(storage, 'ws-a');
    expect(ws.active).toBe(false);
  });
});

describe('ProjectRepository (spec section 10, WS-005 ownership)', () => {
  it('registers a project under a workspace and enforces one owner per path', () => {
    const now = new Date().toISOString();
    storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });

    storage.projects.create({
      id: 'proj-1',
      workspaceId: 'ws-a',
      name: 'my-app',
      canonicalPath: '/Users/dev/my-app',
      filesystemIdentity: null,
      repositoryRoot: null,
      detectedTypes: ['node'],
      createdAt: now,
      updatedAt: now,
    });

    expect(storage.projects.listByWorkspace('ws-a')).toHaveLength(1);
    expect(storage.projects.findByPath('/Users/dev/my-app')).toHaveLength(1);

    expect(() =>
      storage.projects.create({
        id: 'proj-2',
        workspaceId: 'ws-a',
        name: 'my-app-dup',
        canonicalPath: '/Users/dev/my-app',
        filesystemIdentity: null,
        repositoryRoot: null,
        detectedTypes: [],
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it('cascades deletion when the owning workspace is removed', () => {
    const now = new Date().toISOString();
    storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });
    storage.projects.create({
      id: 'proj-1',
      workspaceId: 'ws-a',
      name: 'my-app',
      canonicalPath: '/Users/dev/my-app',
      filesystemIdentity: null,
      repositoryRoot: null,
      detectedTypes: [],
      createdAt: now,
      updatedAt: now,
    });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.projects.listByWorkspace('ws-a')).toHaveLength(0);
  });

  it('findById returns null for an unknown project', () => {
    expect(storage.projects.findById('nope')).toBeNull();
  });

  it('defaults new projects to trustState "untrusted" and round-trips detectedTypes', () => {
    makeWorkspace(storage, 'ws-a');
    const project = makeProject(storage, 'proj-1', 'ws-a', '/Users/dev/my-app');
    expect(project.trustState).toBe('untrusted');
    expect(project.detectedTypes).toEqual(['node']);
    expect(project.lastOpenedAt).toBeNull();
  });

  it('allows the same canonical path to be registered under different workspaces (ownership is per-workspace)', () => {
    makeWorkspace(storage, 'ws-a');
    makeWorkspace(storage, 'ws-b');
    makeProject(storage, 'proj-1', 'ws-a', '/Users/dev/shared-app');
    expect(() => makeProject(storage, 'proj-2', 'ws-b', '/Users/dev/shared-app')).not.toThrow();
    expect(storage.projects.findByPath('/Users/dev/shared-app')).toHaveLength(2);
  });

  it('rejects a project registered under a workspace that does not exist (foreign key)', () => {
    expect(() => makeProject(storage, 'proj-1', 'does-not-exist', '/Users/dev/orphan')).toThrow();
  });
});

describe('OperationRepository (spec sections 23.2.7, 23.2.8)', () => {
  it('findById returns null for an unknown operation', () => {
    expect(storage.operations.findById('nope')).toBeNull();
  });

  it('start() then complete() transitions state and persists exitCode/partialState', () => {
    const started = storage.operations.start({
      id: 'op-1',
      workspaceId: null,
      projectId: null,
      type: 'workspace.create',
      risk: 'local-reversible',
      humanSummary: 'Create workspace',
      startedAt: new Date().toISOString(),
    });
    expect(started.state).toBe('running');

    const completed = storage.operations.complete('op-1', {
      state: 'succeeded',
      endedAt: new Date().toISOString(),
      exitCode: 0,
    });
    expect(completed.state).toBe('succeeded');
    expect(completed.exitCode).toBe(0);
    expect(completed.partialState).toBeNull();
  });

  it('complete() throws for an unknown operation id', () => {
    expect(() =>
      storage.operations.complete('does-not-exist', {
        state: 'succeeded',
        endedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    ).toThrow(/vanished/);
  });

  it('listByWorkspace scopes to the workspace and orders most-recent first', () => {
    makeWorkspace(storage, 'ws-a');
    makeWorkspace(storage, 'ws-b');
    storage.operations.start({
      id: 'op-1',
      workspaceId: 'ws-a',
      projectId: null,
      type: 'a',
      risk: 'observe',
      humanSummary: 'first',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    storage.operations.start({
      id: 'op-2',
      workspaceId: 'ws-a',
      projectId: null,
      type: 'a',
      risk: 'observe',
      humanSummary: 'second',
      startedAt: '2026-01-02T00:00:00.000Z',
    });
    storage.operations.start({
      id: 'op-3',
      workspaceId: 'ws-b',
      projectId: null,
      type: 'a',
      risk: 'observe',
      humanSummary: 'other workspace',
      startedAt: '2026-01-03T00:00:00.000Z',
    });

    expect(storage.operations.listByWorkspace('ws-a').map((o) => o.id)).toEqual(['op-2', 'op-1']);
  });

  it('addStep records a step row against the operation', () => {
    storage.operations.start({
      id: 'op-1',
      workspaceId: null,
      projectId: null,
      type: 'a',
      risk: 'observe',
      humanSummary: 'first',
      startedAt: new Date().toISOString(),
    });
    storage.operations.addStep({
      id: 'step-1',
      operationId: 'op-1',
      sequence: 0,
      type: 'shell',
      state: 'succeeded',
      commandDisplayRedacted: 'git status',
      resultSummary: 'clean',
    });

    const steps = storage.db
      .prepare('SELECT * FROM operation_steps WHERE operation_id = ?')
      .all('op-1') as Array<{ id: string; command_display_redacted: string | null }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.id).toBe('step-1');
    expect(steps[0]?.command_display_redacted).toBe('git status');
  });

  it('cascades operation deletion when the owning workspace is removed', () => {
    makeWorkspace(storage, 'ws-a');
    storage.operations.start({
      id: 'op-1',
      workspaceId: 'ws-a',
      projectId: null,
      type: 'a',
      risk: 'observe',
      humanSummary: 'first',
      startedAt: new Date().toISOString(),
    });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.operations.findById('op-1')).toBeNull();
  });

  it('sets project_id to NULL (not cascading the operation) when the owning project is removed', () => {
    makeWorkspace(storage, 'ws-a');
    makeProject(storage, 'proj-1', 'ws-a', '/Users/dev/my-app');
    storage.operations.start({
      id: 'op-1',
      workspaceId: 'ws-a',
      projectId: 'proj-1',
      type: 'a',
      risk: 'observe',
      humanSummary: 'first',
      startedAt: new Date().toISOString(),
    });
    storage.db.prepare('DELETE FROM projects WHERE id = ?').run('proj-1');
    expect(storage.operations.findById('op-1')?.projectId).toBeNull();
  });
});

describe('withReceipt (spec section 33: every mutating command has a receipt)', () => {
  it('records a succeeded operation around a successful action', async () => {
    const { result, operation } = await withReceipt(
      storage.operations,
      { workspaceId: null, projectId: null, type: 'workspace.create', risk: 'local-reversible', humanSummary: 'Create workspace "Test"' },
      () => 'ok',
    );
    expect(result).toBe('ok');
    expect(operation.state).toBe('succeeded');
    expect(operation.exitCode).toBe(0);
    expect(storage.operations.findById(operation.id)?.state).toBe('succeeded');
  });

  it('records a failed operation and still rethrows', async () => {
    const now = new Date().toISOString();
    storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: now, updatedAt: now });

    await expect(
      withReceipt(
        storage.operations,
        { workspaceId: 'ws-a', projectId: null, type: 'workspace.create', risk: 'local-reversible', humanSummary: 'boom' },
        () => {
          throw new Error('disk full');
        },
      ),
    ).rejects.toThrow('disk full');

    const operations = storage.operations.listByWorkspace('ws-a');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.state).toBe('failed');
    expect(operations[0]?.partialState).toEqual({ error: 'disk full' });
  });
});

describe('ActivityRepository (spec 23.2.9, section 17)', () => {
  it('records an activity event and reads it back with metadata round-tripped', () => {
    makeWorkspace(storage, 'ws-a');
    const recorded = storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-07-12T10:00:00.000Z',
      subjectRef: 'abc123',
      summary: 'Commit "fix bug"',
      weight: 3,
      metadata: { sha: 'abc123' },
    });
    expect(recorded.id).toBeTruthy();
    expect(recorded.metadata).toEqual({ sha: 'abc123' });

    const found = storage.activity.listByWorkspaceInRange('ws-a', {
      fromInclusive: '2026-07-01T00:00:00.000Z',
      toInclusive: '2026-07-31T23:59:59.999Z',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.eventType).toBe('commit');
  });

  it('scopes listByWorkspaceInRange by both workspace and the requested date range', () => {
    makeWorkspace(storage, 'ws-a');
    makeWorkspace(storage, 'ws-b');
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-07-05T00:00:00.000Z',
      subjectRef: null,
      summary: 'in range, ws-a',
      weight: 1,
      metadata: null,
    });
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-08-05T00:00:00.000Z',
      subjectRef: null,
      summary: 'out of range',
      weight: 1,
      metadata: null,
    });
    storage.activity.record({
      workspaceId: 'ws-b',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-07-05T00:00:00.000Z',
      subjectRef: null,
      summary: 'other workspace',
      weight: 1,
      metadata: null,
    });

    const found = storage.activity.listByWorkspaceInRange('ws-a', {
      fromInclusive: '2026-07-01T00:00:00.000Z',
      toInclusive: '2026-07-31T23:59:59.999Z',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toBe('in range, ws-a');
  });

  it('pruneOlderThan removes exactly the rows older than an explicit cutoff (spec 27.4)', () => {
    makeWorkspace(storage, 'ws-a');
    // Both events are well within ACTIVITY_RETENTION_DAYS of each other, so
    // `record()`'s own auto-prune (tested separately below) never touches
    // either one — this test is purely about `pruneOlderThan`'s own
    // cutoff-based deletion, called explicitly with an arbitrary date.
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-01-01T00:00:00.000Z',
      subjectRef: null,
      summary: 'earlier-in-2026',
      weight: 1,
      metadata: null,
    });
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-07-01T00:00:00.000Z',
      subjectRef: null,
      summary: 'recent',
      weight: 1,
      metadata: null,
    });

    const removed = storage.activity.pruneOlderThan('2026-03-01T00:00:00.000Z');
    expect(removed).toBe(1);

    const remaining = storage.activity.listByWorkspaceInRange('ws-a', {
      fromInclusive: '2000-01-01T00:00:00.000Z',
      toInclusive: '2030-01-01T00:00:00.000Z',
    });
    expect(remaining.map((e) => e.summary)).toEqual(['recent']);
  });

  it('record() self-enforces the activity retention limit on every write (spec 27.4) — no external caller has to remember to prune', () => {
    makeWorkspace(storage, 'ws-a');
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2020-01-01T00:00:00.000Z',
      subjectRef: null,
      summary: 'ancient',
      weight: 1,
      metadata: null,
    });

    // No manual pruneOlderThan call here — recording a second, far-later
    // event is itself what should evict the first (well beyond
    // ACTIVITY_RETENTION_DAYS = 400 days before this one).
    storage.activity.record({
      workspaceId: 'ws-a',
      projectId: null,
      eventType: 'commit',
      occurredAt: '2026-07-13T00:00:00.000Z',
      subjectRef: null,
      summary: 'recent',
      weight: 1,
      metadata: null,
    });

    const remaining = storage.activity.listByWorkspaceInRange('ws-a', {
      fromInclusive: '2000-01-01T00:00:00.000Z',
      toInclusive: '2030-01-01T00:00:00.000Z',
    });
    expect(remaining.map((e) => e.summary)).toEqual(['recent']);
  });
});
