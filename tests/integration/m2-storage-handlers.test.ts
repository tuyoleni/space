/**
 * Exercises the storage worker's request handler (spec section 36.2 exit
 * criteria: "user can create and switch workspaces and add folders") end
 * to end against a real SQLite database and a real temp directory on
 * disk — the same code path (apps/desktop/src/main/storage-handlers.ts)
 * the utility-process worker runs, minus the Electron IPC transport
 * itself, which has no meaningful behaviour of its own beyond forwarding.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '@space/storage';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import type { StorageRequest } from '../../apps/desktop/src/main/storage-protocol';
import type { Project, ProjectInspection, Workspace, WorkspaceSummary } from '@space/contracts';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m2-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let requestSequence = 0;
function send<T>(method: StorageRequest['method'], payload: unknown): Promise<T> {
  requestSequence += 1;
  return handleStorageRequest(storage, {
    id: `req-${requestSequence}`,
    method,
    payload,
  }) as Promise<T>;
}

describe('workspace.create / workspace.list (spec section 36.2)', () => {
  it('creates a workspace, leaves a receipt, and lists it as inactive', async () => {
    const workspace = await send<Workspace>('workspace.create', { name: 'Client A' });
    expect(workspace.name).toBe('Client A');
    expect(workspace.active).toBe(false);
    expect(workspace.id).toBeTruthy();

    const list = await send<WorkspaceSummary[]>('workspace.list', undefined);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(workspace.id);

    // workspace.create's receipt has no workspaceId (the workspace didn't exist
    // yet when the operation started), so query operations directly by type.
    const receipts = storage.db.prepare('SELECT * FROM operations WHERE type = ?').all('workspace.create') as Array<{
      state: string;
    }>;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.state).toBe('succeeded');
  });

  it('rejects workspace.create with an empty name via zod validation', async () => {
    await expect(send('workspace.create', { name: '' })).rejects.toThrow();
    expect(await send<WorkspaceSummary[]>('workspace.list', undefined)).toEqual([]);
  });
});

describe('workspace.activate (spec section 36.2, WS-006)', () => {
  it('switches the active workspace and records a receipt against it', async () => {
    const a = await send<Workspace>('workspace.create', { name: 'A' });
    const b = await send<Workspace>('workspace.create', { name: 'B' });

    await send('workspace.activate', { workspaceId: a.id });
    let list = await send<WorkspaceSummary[]>('workspace.list', undefined);
    expect(list.find((w) => w.id === a.id)?.active).toBe(true);
    expect(list.find((w) => w.id === b.id)?.active).toBe(false);

    await send('workspace.activate', { workspaceId: b.id });
    list = await send<WorkspaceSummary[]>('workspace.list', undefined);
    expect(list.find((w) => w.id === b.id)?.active).toBe(true);
    expect(list.find((w) => w.id === a.id)?.active).toBe(false);

    const receipts = storage.operations.listByWorkspace(b.id);
    expect(receipts.some((op) => op.type === 'workspace.activate' && op.state === 'succeeded')).toBe(true);
  });

  it('rejects activating an unknown workspace', async () => {
    await expect(send('workspace.activate', { workspaceId: 'does-not-exist' })).rejects.toThrow();
  });
});

describe('project.inspectFolder / project.add (spec section 36.2)', () => {
  it('inspects a real directory on disk and reports git + registration state', async () => {
    const workspace = await send<Workspace>('workspace.create', { name: 'A' });
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(projectDir, '.git'));

    const before = await send<ProjectInspection>('project.inspectFolder', { path: projectDir });
    expect(before.exists).toBe(true);
    expect(before.isDirectory).toBe(true);
    expect(before.isGitRepository).toBe(true);
    expect(before.alreadyRegisteredInWorkspaceId).toBeNull();

    const project = await send<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });
    expect(project.workspaceId).toBe(workspace.id);
    expect(project.detectedTypes).toEqual(['node']);
    // M8: canonicalPath is now resolved through fs.realpathSync (spec 30.3
    // "treat symlinks explicitly"), not just path.resolve — on macOS the
    // real temp dir is under /private/var, which os.tmpdir() masks behind
    // a /var symlink, so the expectation must resolve the same way.
    expect(project.repositoryRoot).toBe(fs.realpathSync(projectDir));
    expect(project.trustState).toBe('untrusted');

    const after = await send<ProjectInspection>('project.inspectFolder', { path: projectDir });
    expect(after.alreadyRegisteredInWorkspaceId).toBe(workspace.id);

    const listed = await send<Project[]>('project.list', { workspaceId: workspace.id });
    expect(listed.map((p) => p.id)).toEqual([project.id]);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.add' && op.state === 'succeeded')).toBe(true);
  });

  it('resolves a symlinked folder to its real target path (spec 30.3: "treat symlinks explicitly")', async () => {
    const workspace = await send<Workspace>('workspace.create', { name: 'A' });
    const realDir = fs.mkdtempSync(path.join(dir, 'real-'));
    fs.writeFileSync(path.join(realDir, 'package.json'), '{}');
    const symlinkPath = path.join(dir, 'link-to-real');
    fs.symlinkSync(realDir, symlinkPath, 'dir');

    const inspection = await send<ProjectInspection>('project.inspectFolder', { path: symlinkPath });
    expect(inspection.path).toBe(fs.realpathSync(realDir));
    expect(inspection.path).not.toBe(symlinkPath);

    const project = await send<Project>('project.add', { workspaceId: workspace.id, canonicalPath: symlinkPath });
    // The project is tracked under the real directory, not the symlink
    // path it was added through — so a later `git`/process spawn using
    // this canonicalPath as cwd always operates on the real location,
    // and adding the same real directory again (even via a different
    // symlink) would be recognised as already registered.
    expect(project.canonicalPath).toBe(fs.realpathSync(realDir));
    expect(project.canonicalPath).not.toBe(symlinkPath);

    const reinspected = await send<ProjectInspection>('project.inspectFolder', { path: realDir });
    expect(reinspected.alreadyRegisteredInWorkspaceId).toBe(workspace.id);
  });

  it('project.list is empty for a fresh workspace and scoped per workspace', async () => {
    const a = await send<Workspace>('workspace.create', { name: 'A' });
    const b = await send<Workspace>('workspace.create', { name: 'B' });
    expect(await send<Project[]>('project.list', { workspaceId: a.id })).toEqual([]);

    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    await send<Project>('project.add', { workspaceId: a.id, canonicalPath: projectDir });

    expect(await send<Project[]>('project.list', { workspaceId: a.id })).toHaveLength(1);
    expect(await send<Project[]>('project.list', { workspaceId: b.id })).toEqual([]);
  });

  it('reports a non-existent path as not existing, not throwing', async () => {
    const inspection = await send<ProjectInspection>('project.inspectFolder', {
      path: path.join(dir, 'never-created'),
    });
    expect(inspection.exists).toBe(false);
    expect(inspection.isDirectory).toBe(false);
    expect(inspection.isGitRepository).toBe(false);
  });

  it('rejects adding a project under a workspace that does not exist', async () => {
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    await expect(
      send('project.add', { workspaceId: 'does-not-exist', canonicalPath: projectDir }),
    ).rejects.toThrow();
  });

  it('rejects adding a path that is not a directory', async () => {
    const workspace = await send<Workspace>('workspace.create', { name: 'A' });
    const filePath = path.join(dir, 'not-a-directory.txt');
    fs.writeFileSync(filePath, 'hello');
    await expect(
      send('project.add', { workspaceId: workspace.id, canonicalPath: filePath }),
    ).rejects.toThrow(/not an accessible directory/);
  });
});
