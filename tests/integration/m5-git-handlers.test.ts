/**
 * M5: createGitHandlers exercised end to end (spec section 36.5 exit
 * criteria: "daily Git work can be completed without leaving Space, while
 * every action remains a real Git operation") against real, temporary,
 * test-owned repositories and a real temp-directory SQLite database (via
 * handleStorageRequest, mirroring m4-project-handlers.test.ts). Fetch/
 * pull/push only ever target a local `git init --bare` directory standing
 * in for a remote — never a real network or credentials (M6's scope).
 *
 * `GIT_CONFIG_GLOBAL` is redirected to a temp file for this file's tests
 * only, restored in afterEach, so commit-identity resolution (which reads
 * `git config --global`) is hermetic and never touches this machine's
 * real ~/.gitconfig.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, Workspace } from '@space/contracts';
import { createStorage, type Storage } from '@space/storage';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import { createGitHandlers } from '../../apps/desktop/src/main/git-handlers';
import type { StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;
let originalGitConfigGlobal: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m5-handlers-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storageCaller = {
    call: <T>(method: StorageMethod, payload: unknown) => {
      requestSequence += 1;
      return handleStorageRequest(storage, { id: `req-${requestSequence}`, method, payload }) as Promise<T>;
    },
  };

  originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  const globalConfigPath = path.join(dir, 'test.gitconfig');
  fs.writeFileSync(globalConfigPath, '[user]\n\tname = Space Test\n\temail = space-test@example.com\n');
  process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
});

afterEach(() => {
  if (originalGitConfigGlobal === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
  }
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeWorkspace(name = 'A'): Promise<Workspace> {
  return storageCaller.call<Workspace>('workspace.create', { name });
}

async function makeRepoProject(workspaceId: string, dirName: string): Promise<Project> {
  const target = path.join(dir, dirName);
  fs.mkdirSync(target);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: target });
  return storageCaller.call<Project>('project.add', { workspaceId, canonicalPath: target });
}

describe('GIT-001/004/005: status, staging, commit end to end', () => {
  it('reports real status, stages/unstages a file, commits with a verified SHA, and records a receipt + activity event', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    let status = await handlers.status({ projectId: project.id });
    expect(status.branch.isInitial).toBe(true);
    expect(status.operationState).toEqual({ kind: 'none' });

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'hello\n');
    status = await handlers.status({ projectId: project.id });
    expect(status.entries.some((e) => e.kind === 'untracked' && e.path === 'a.txt')).toBe(true);

    await handlers.stage({ projectId: project.id, paths: ['a.txt'] });
    status = await handlers.status({ projectId: project.id });
    expect(status.entries[0]).toMatchObject({ indexStatus: 'A' });

    const outcome = await handlers.commit({ projectId: project.id, message: 'add a.txt' });
    const realSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(dir, 'project') }).toString().trim();
    expect(outcome.sha).toBe(realSha);

    // `git restore --staged` (unstage) needs a resolvable HEAD, so it's
    // exercised here against the second change rather than the very first
    // (pre-commit) one.
    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'hello again\n');
    await handlers.stage({ projectId: project.id, paths: ['a.txt'] });
    status = await handlers.status({ projectId: project.id });
    expect(status.entries[0]).toMatchObject({ indexStatus: 'M' });

    await handlers.unstage({ projectId: project.id, paths: ['a.txt'] });
    status = await handlers.status({ projectId: project.id });
    expect(status.entries[0]).toMatchObject({ indexStatus: '.', worktreeStatus: 'M' });

    const author = execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: path.join(dir, 'project') })
      .toString()
      .trim();
    expect(author).toBe('Space Test <space-test@example.com>');

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'git.commit' && op.state === 'succeeded')).toBe(true);

    const events = storage.activity.listByWorkspaceInRange(workspace.id, {
      fromInclusive: '2000-01-01T00:00:00.000Z',
      toInclusive: '2100-01-01T00:00:00.000Z',
    });
    const commitEvent = events.find((e) => e.eventType === 'commit');
    expect(commitEvent?.subjectRef).toBe(realSha);
  });
});

describe('GIT-006: branches end to end', () => {
  it('creates, switches, and lists real branches via for-each-ref', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'x\n');
    await handlers.stage({ projectId: project.id, paths: ['a.txt'] });
    await handlers.commit({ projectId: project.id, message: 'init' });

    await handlers.createBranch({ projectId: project.id, name: 'feature' });
    await handlers.switchBranch({ projectId: project.id, name: 'feature' });

    const branches = await handlers.listBranches({ projectId: project.id });
    const feature = branches.find((b) => b.shortName === 'feature');
    expect(feature?.isHead).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'git.branch.create' && op.state === 'succeeded')).toBe(true);
    expect(receipts.some((op) => op.type === 'git.branch.switch' && op.state === 'succeeded')).toBe(true);
  });

  it('refuses to delete an unmerged branch without force, and records the failed attempt as a receipt', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'x\n');
    await handlers.stage({ projectId: project.id, paths: ['a.txt'] });
    await handlers.commit({ projectId: project.id, message: 'init' });
    await handlers.createBranch({ projectId: project.id, name: 'unmerged' });
    await handlers.switchBranch({ projectId: project.id, name: 'unmerged' });
    fs.writeFileSync(path.join(dir, 'project', 'b.txt'), 'y\n');
    await handlers.stage({ projectId: project.id, paths: ['b.txt'] });
    await handlers.commit({ projectId: project.id, message: 'unmerged work' });
    await handlers.switchBranch({ projectId: project.id, name: 'main' });

    await expect(
      handlers.deleteBranch({ projectId: project.id, name: 'unmerged', force: false, confirmed: true }),
    ).rejects.toThrow();

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'git.branch.delete' && op.state === 'failed')).toBe(true);
  });
});

describe('GIT-002/12.5: history end to end', () => {
  it('loads a real, paginated history page', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    for (let i = 0; i < 5; i += 1) {
      fs.writeFileSync(path.join(dir, 'project', 'a.txt'), `${i}\n`);
      await handlers.stage({ projectId: project.id, paths: ['a.txt'] });
      await handlers.commit({ projectId: project.id, message: `commit ${i}` });
    }

    const page = await handlers.loadHistory({ projectId: project.id, offset: 0, count: 3 });
    expect(page.commits).toHaveLength(3);
    expect(page.commits[0]?.subject).toBe('commit 4');
  });
});

describe('GIT-007: fetch, pull, and push end to end against a local bare "remote"', () => {
  it('pushes, then a second project can fetch and pull it', async () => {
    const workspace = await makeWorkspace();

    const bare = path.join(dir, 'remote.git');
    fs.mkdirSync(bare);
    execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main'], { cwd: bare });

    const cloneDir = path.join(dir, 'clone');
    execFileSync('git', ['clone', '-q', bare, cloneDir]);
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: cloneDir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: cloneDir });
    fs.writeFileSync(path.join(cloneDir, 'a.txt'), 'x\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: cloneDir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: cloneDir });
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: cloneDir });

    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });
    await handlers.push({ projectId: project.id, branch: 'main', setUpstream: true });

    const secondCloneDir = path.join(dir, 'clone-2');
    execFileSync('git', ['clone', '-q', bare, secondCloneDir]);
    const secondProject = await storageCaller.call<Project>('project.add', {
      workspaceId: workspace.id,
      canonicalPath: secondCloneDir,
    });

    fs.writeFileSync(path.join(cloneDir, 'b.txt'), 'y\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: cloneDir });
    execFileSync('git', ['commit', '-q', '-m', 'second commit'], { cwd: cloneDir });
    await handlers.push({ projectId: project.id, branch: 'main' });

    await handlers.fetch({ projectId: secondProject.id });
    const remoteRefs = execFileSync('git', ['log', 'origin/main', '--oneline'], { cwd: secondCloneDir }).toString();
    expect(remoteRefs).toContain('second commit');

    await handlers.pull({ projectId: secondProject.id, mode: 'merge', branch: 'main' });
    expect(fs.existsSync(path.join(secondCloneDir, 'b.txt'))).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'git.push' && op.state === 'succeeded')).toBe(true);
    expect(receipts.some((op) => op.type === 'git.fetch' && op.state === 'succeeded')).toBe(true);
    expect(receipts.some((op) => op.type === 'git.pull' && op.state === 'succeeded')).toBe(true);
  });
});

describe('GIT-008: conflict state, continue, and abort end to end', () => {
  async function makeConflictingProject(workspaceId: string): Promise<Project> {
    const project = await makeRepoProject(workspaceId, 'project');
    const target = path.join(dir, 'project');
    fs.writeFileSync(path.join(target, 'a.txt'), 'base\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: target });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: target });
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: target });
    fs.writeFileSync(path.join(target, 'a.txt'), 'feature change\n');
    execFileSync('git', ['commit', '-q', '-am', 'feature change'], { cwd: target });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: target });
    fs.writeFileSync(path.join(target, 'a.txt'), 'main change\n');
    execFileSync('git', ['commit', '-q', '-am', 'main change'], { cwd: target });
    try {
      execFileSync('git', ['merge', '--no-edit', 'feature'], { cwd: target, stdio: 'pipe' });
    } catch {
      // Expected: the merge stops with a conflict.
    }
    return project;
  }

  it('represents a real conflict, resolves, and continues to a completed merge', async () => {
    const workspace = await makeWorkspace();
    const project = await makeConflictingProject(workspace.id);
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    const state = await handlers.conflictState({ projectId: project.id });
    expect(state.inConflict).toBe(true);
    expect(state.conflictedFiles).toEqual(['a.txt']);

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'resolved\n');
    await handlers.stage({ projectId: project.id, paths: ['a.txt'] });

    const outcome = await handlers.continueConflict({ projectId: project.id });
    expect(outcome.completed).toBe(true);

    const after = await handlers.conflictState({ projectId: project.id });
    expect(after.inConflict).toBe(false);
  });

  it('aborts a conflicted merge back to the pre-merge state', async () => {
    const workspace = await makeWorkspace();
    const project = await makeConflictingProject(workspace.id);
    const target = path.join(dir, 'project');
    const beforeAbortSha = execFileSync('git', ['rev-parse', 'main'], { cwd: target }).toString().trim();
    const handlers = createGitHandlers(storageCaller, { historyCacheDir: path.join(dir, 'cache') });

    const outcome = await handlers.abortConflict({ projectId: project.id });
    expect(outcome.completed).toBe(true);

    const afterAbortSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
    expect(afterAbortSha).toBe(beforeAbortSha);
  });
});
