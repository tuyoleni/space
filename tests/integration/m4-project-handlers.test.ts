/**
 * M4: createProjectHandlers exercised end to end against a real temp-
 * directory SQLite database (via handleStorageRequest, the same code path
 * the storage worker runs — mirrors m2-storage-handlers.test.ts) and real
 * child processes (git clone against a local fixture repo, npm install
 * with no dependencies, npm init --yes). No Electron utilityProcess is
 * involved; `StorageCaller` is deliberately a minimal interface so this
 * test can supply a fake that calls straight into the real storage layer.
 *
 * This proves the trust gate is a structural gate, not a convention:
 * installDependencies/startDevServer both throw for an untrusted project
 * unless allowOnce is set, before any process is spawned.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, Workspace } from '@space/contracts';
import { createStorage, type Storage } from '@space/storage';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import { createProjectHandlers, type StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m4-handlers-'));
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

describe('createFromTemplate + clone (PRJ-001/004)', () => {
  it('creates a real project from the node-minimal template and registers it untrusted', async () => {
    const workspace = await makeWorkspace();
    const handlers = createProjectHandlers(storageCaller);

    const project = await handlers.createFromTemplate({
      workspaceId: workspace.id,
      templateId: 'node-minimal',
      destinationParentDirectory: dir,
      name: 'created-app',
    });

    expect(project.trustState).toBe('untrusted');
    expect(fs.existsSync(path.join(dir, 'created-app', 'package.json'))).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.createFromTemplate' && op.state === 'succeeded')).toBe(true);
  });

  it('clones a real local fixture repository and registers it untrusted', async () => {
    const workspace = await makeWorkspace();
    const sourceRepo = path.join(dir, 'source');
    fs.mkdirSync(sourceRepo);
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: sourceRepo });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: sourceRepo });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: sourceRepo });
    fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRepo });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: sourceRepo });

    const handlers = createProjectHandlers(storageCaller);
    const project = await handlers.clone({
      workspaceId: workspace.id,
      remoteUrl: sourceRepo,
      destinationParentDirectory: dir,
      name: 'cloned-app',
    });

    expect(project.trustState).toBe('untrusted');
    expect(project.repositoryRoot).toBe(path.join(dir, 'cloned-app'));
    expect(fs.readFileSync(path.join(dir, 'cloned-app', 'README.md'), 'utf-8')).toBe('# fixture\n');

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.clone' && op.state === 'succeeded')).toBe(true);
  });
});

describe('installDependencies is gated by trust (PRJ-003 structural gate)', () => {
  it('refuses to install for an untrusted project without ever spawning npm', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });
    expect(project.trustState).toBe('untrusted');

    const handlers = createProjectHandlers(storageCaller);
    await expect(handlers.installDependencies({ projectId: project.id })).rejects.toThrow(/untrusted/);
    expect(fs.existsSync(path.join(projectDir, 'node_modules'))).toBe(false);
  });

  it('allow-once permits exactly one install without trusting the project permanently', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    const result = await handlers.installDependencies({ projectId: project.id, packageManager: 'npm', allowOnce: true });
    expect(result.succeeded).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'package-lock.json'))).toBe(true);

    const reread = await storageCaller.call<Project>('project.get', { projectId: project.id });
    expect(reread.trustState).toBe('untrusted');
  }, 30000);

  it('installs for real once the project is explicitly trusted', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    const trusted = await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    expect(trusted.trustState).toBe('trusted');

    const result = await handlers.installDependencies({ projectId: project.id, packageManager: 'npm' });
    expect(result.succeeded).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.installDependencies' && op.state === 'succeeded')).toBe(true);
  }, 30000);
});

describe('startDevServer is gated by trust and requires a real dev/start script', () => {
  it('refuses to start a dev server for an untrusted project', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node -e "console.log(1)"' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await expect(handlers.startDevServer({ projectId: project.id })).rejects.toThrow(/untrusted/);
  });

  it('throws a clear error when there is no dev/start script, even if trusted', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    await expect(handlers.startDevServer({ projectId: project.id })).rejects.toThrow(/No "dev" or "start" script/);
  });
});
