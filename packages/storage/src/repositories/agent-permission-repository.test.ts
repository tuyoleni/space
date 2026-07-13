import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-agent-permission-'));
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

describe('AgentPermissionRepository (spec 19.2.3/19.2.4)', () => {
  it('grants a workspace-scoped standing permission and finds it as the active grant', () => {
    const granted = storage.agentPermissions.grant({
      id: 'grant-1',
      workspaceId: 'ws-a',
      projectId: null,
      actionType: 'github.createPullRequest',
      grantedAt: '2026-07-13T00:00:00.000Z',
    });
    expect(granted.revokedAt).toBeNull();

    const active = storage.agentPermissions.findActiveGrant('ws-a', null, 'github.createPullRequest');
    expect(active?.id).toBe('grant-1');
  });

  it('grants a project-scoped standing permission that does not satisfy a workspace-wide (null project) lookup', () => {
    storage.agentPermissions.grant({
      id: 'grant-1',
      workspaceId: 'ws-a',
      projectId: 'proj-a',
      actionType: 'github.createPullRequest',
      grantedAt: '2026-07-13T00:00:00.000Z',
    });
    expect(storage.agentPermissions.findActiveGrant('ws-a', 'proj-a', 'github.createPullRequest')?.id).toBe('grant-1');
    expect(storage.agentPermissions.findActiveGrant('ws-a', null, 'github.createPullRequest')).toBeNull();
  });

  it('revoke is idempotent and removes the grant from active lookup', () => {
    storage.agentPermissions.grant({
      id: 'grant-1',
      workspaceId: 'ws-a',
      projectId: null,
      actionType: 'git.push',
      grantedAt: '2026-07-13T00:00:00.000Z',
    });
    storage.agentPermissions.revoke('grant-1', '2026-07-13T01:00:00.000Z');
    expect(storage.agentPermissions.findActiveGrant('ws-a', null, 'git.push')).toBeNull();
    expect(storage.agentPermissions.findById('grant-1')?.revokedAt).toBe('2026-07-13T01:00:00.000Z');

    // Revoking again (or a nonexistent id) is a no-op, not an error.
    expect(() => storage.agentPermissions.revoke('grant-1', '2026-07-13T02:00:00.000Z')).not.toThrow();
    expect(storage.agentPermissions.findById('grant-1')?.revokedAt).toBe('2026-07-13T01:00:00.000Z');
    expect(() => storage.agentPermissions.revoke('does-not-exist', '2026-07-13T02:00:00.000Z')).not.toThrow();
  });

  it('listByWorkspace returns every grant (active and revoked) newest first', () => {
    storage.agentPermissions.grant({ id: 'grant-1', workspaceId: 'ws-a', projectId: null, actionType: 'git.push', grantedAt: '2026-07-13T00:00:00.000Z' });
    storage.agentPermissions.grant({ id: 'grant-2', workspaceId: 'ws-a', projectId: null, actionType: 'github.createPullRequest', grantedAt: '2026-07-13T01:00:00.000Z' });
    const list = storage.agentPermissions.listByWorkspace('ws-a');
    expect(list.map((g) => g.id)).toEqual(['grant-2', 'grant-1']);
  });

  it('cascades deletion when the owning workspace is removed', () => {
    storage.agentPermissions.grant({ id: 'grant-1', workspaceId: 'ws-a', projectId: null, actionType: 'git.push', grantedAt: '2026-07-13T00:00:00.000Z' });
    storage.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-a');
    expect(storage.agentPermissions.findById('grant-1')).toBeNull();
  });

  it('cascades deletion when a project-scoped grant\'s project is removed', () => {
    storage.agentPermissions.grant({ id: 'grant-1', workspaceId: 'ws-a', projectId: 'proj-a', actionType: 'git.push', grantedAt: '2026-07-13T00:00:00.000Z' });
    storage.db.prepare('DELETE FROM projects WHERE id = ?').run('proj-a');
    expect(storage.agentPermissions.findById('grant-1')).toBeNull();
  });

  it('findById returns null for an unknown grant', () => {
    expect(storage.agentPermissions.findById('nope')).toBeNull();
  });
});
