import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-service-connection-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: 'now', updatedAt: 'now' });
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SecretRefRepository (spec 23.2.6 — never a secret value column)', () => {
  it('creates a reference keyed by service/account, never a secret value', () => {
    const ref = storage.secretRefs.create({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    expect(ref).toEqual({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    expect(Object.keys(ref)).not.toContain('secret');
    expect(Object.keys(ref)).not.toContain('value');
    expect(Object.keys(ref)).not.toContain('token');
  });

  it('is idempotent by (serviceName, accountKey) — a second create returns the existing row', () => {
    const first = storage.secretRefs.create({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    const second = storage.secretRefs.create({
      id: 'sref-2',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T11:00:00Z',
    });
    expect(second.id).toBe(first.id);
    expect(storage.secretRefs.findById('sref-2')).toBeNull();
  });

  it('findByServiceAccount / findById / delete', () => {
    storage.secretRefs.create({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    expect(storage.secretRefs.findByServiceAccount('space.github', 'ws-a:github.com')?.id).toBe('sref-1');
    expect(storage.secretRefs.findByServiceAccount('space.github', 'unknown')).toBeNull();
    storage.secretRefs.delete('sref-1');
    expect(storage.secretRefs.findById('sref-1')).toBeNull();
  });

  it('cascades deletion when the owning workspace is removed', () => {
    storage.secretRefs.create({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.secretRefs.findById('sref-1')).toBeNull();
  });
});

describe('ServiceConnectionRepository (spec 23.2.5)', () => {
  it('upserts a connection scoped to workspace/adapter/host', () => {
    const created = storage.serviceConnections.upsert({
      id: 'conn-1',
      workspaceId: 'ws-a',
      adapterId: 'github',
      host: 'github.com',
      accountLabel: 'octocat',
      profileLabel: null,
      secretRefId: null,
      state: 'disconnected',
      lastVerifiedAt: null,
    });
    expect(created.state).toBe('disconnected');

    const updated = storage.serviceConnections.upsert({
      id: 'ignored-since-existing-row-wins',
      workspaceId: 'ws-a',
      adapterId: 'github',
      host: 'github.com',
      accountLabel: 'octocat',
      profileLabel: null,
      secretRefId: null,
      state: 'connected',
      lastVerifiedAt: '2026-07-12T12:00:00Z',
    });
    expect(updated.id).toBe('conn-1');
    expect(updated.state).toBe('connected');
    expect(storage.serviceConnections.listByWorkspace('ws-a')).toHaveLength(1);
  });

  it('links to a secret ref and sets it null (never cascading the connection) when the secret ref is removed', () => {
    storage.secretRefs.create({
      id: 'sref-1',
      workspaceId: 'ws-a',
      provider: 'github',
      serviceName: 'space.github',
      accountKey: 'ws-a:github.com',
      createdAt: '2026-07-12T10:00:00Z',
    });
    storage.serviceConnections.upsert({
      id: 'conn-1',
      workspaceId: 'ws-a',
      adapterId: 'github',
      host: 'github.com',
      accountLabel: 'octocat',
      profileLabel: null,
      secretRefId: 'sref-1',
      state: 'connected',
      lastVerifiedAt: null,
    });
    storage.secretRefs.delete('sref-1');
    expect(storage.serviceConnections.findById('conn-1')?.secretRefId).toBeNull();
  });

  it('cascades deletion when the owning workspace is removed', () => {
    storage.serviceConnections.upsert({
      id: 'conn-1',
      workspaceId: 'ws-a',
      adapterId: 'github',
      host: 'github.com',
      accountLabel: null,
      profileLabel: null,
      secretRefId: null,
      state: 'disconnected',
      lastVerifiedAt: null,
    });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.serviceConnections.findById('conn-1')).toBeNull();
  });

  it('findById returns null for an unknown connection', () => {
    expect(storage.serviceConnections.findById('nope')).toBeNull();
  });
});
