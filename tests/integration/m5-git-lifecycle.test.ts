/**
 * M5 (spec section 36.5, Phase 4: complete local Git) end-to-end coverage
 * against real, temporary, test-owned repositories — no fixtures standing
 * in for a real git operation in production code (spec section 39). A
 * local `git init --bare` directory stands in for a remote so fetch/pull/
 * push are exercised for real without any network access, matching how
 * tests/integration/m4-git-clone.test.ts already treats a scratch `git
 * init` repo as its clone source.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DestructiveGitActionNotConfirmedError } from '@space/domain';
import {
  compareBranches,
  createBranch,
  createNodeGitExecutor,
  deleteBranch,
  deriveConflictState,
  detectRepositoryOperationState,
  fetchRemote,
  getFullRepositoryStatus,
  isBranchMerged,
  parseForEachRefOutput,
  pullRemote,
  pushToRemote,
  readRepoLocalIdentity,
  resolveCommitIdentity,
  runCommit,
  runInitPreflight,
  initRepository,
  stageFiles,
  switchBranch,
  unstageFiles,
  verifyIntendedIndexState,
  forEachRefArgs,
  continueOperation,
  abortOperation,
  type GitDirFsPort,
  type GitExecutor,
  type GitIdentity,
} from '@space/git-engine';

const executor: GitExecutor = createNodeGitExecutor();
const realFs: GitDirFsPort = { exists: async (p) => fs.existsSync(p) };

const workspaceIdentity: GitIdentity = {
  name: 'Space Test',
  email: 'space-test@example.com',
  signingPolicy: 'none',
  signingKeyId: null,
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m5-lifecycle-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GIT-002/003: init preflight, identity, and a real git init', () => {
  it('detects no enclosing repository, initialises with the requested branch, and resolves workspace identity', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);

    const preflight = await runInitPreflight(target, 'trunk', {
      executor,
      canWrite: async () => true,
    });
    expect(preflight.nestedRepositoryWarning).toBeNull();
    expect(preflight.canProceed).toBe(true);
    expect(preflight.defaultBranch).toBe('trunk');

    await initRepository(target, preflight.defaultBranch, executor);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);

    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: target }).toString().trim();
    expect(branch).toBe('trunk');

    const repoLocal = await readRepoLocalIdentity(target, executor);
    expect(repoLocal).toEqual({ name: null, email: null });

    const resolution = resolveCommitIdentity({ workspaceIdentity, repoLocal, overrideAcknowledged: false });
    expect(resolution.source).toBe('workspace');
    expect(resolution.mismatch).toBe(false);
  });

  it('warns about nesting when initialising inside an existing repository', async () => {
    const parent = path.join(dir, 'parent');
    fs.mkdirSync(parent);
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: parent });
    const nested = path.join(parent, 'nested');
    fs.mkdirSync(nested);

    const preflight = await runInitPreflight(nested, undefined, { executor, canWrite: async () => true });
    expect(preflight.nestedRepositoryWarning).toBe(fs.realpathSync(parent));
  });
});

describe('GIT-001/004/005: status, staging, and a real commit with SHA verification', () => {
  it('stages a file, commits it with the resolved identity, and verifies the resulting SHA', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    await initRepository(target, 'main', executor);
    fs.writeFileSync(path.join(target, 'a.txt'), 'hello\n');

    let full = await getFullRepositoryStatus(target, executor, realFs);
    expect(full.status.branch.isInitial).toBe(true);
    expect(full.status.entries.find((e) => e.kind === 'untracked' && e.path === 'a.txt')).toBeTruthy();
    expect(full.operationState).toEqual({ kind: 'none' });

    await stageFiles(target, ['a.txt'], executor);
    full = await getFullRepositoryStatus(target, executor, realFs);
    expect(() => verifyIntendedIndexState(full.status, ['a.txt'])).not.toThrow();
    expect(() => verifyIntendedIndexState(full.status, ['b.txt'])).toThrow();

    const outcome = await runCommit(target, { identity: workspaceIdentity, message: 'add a.txt' }, executor);
    const realSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
    expect(outcome.sha).toBe(realSha);

    const author = execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: target }).toString().trim();
    expect(author).toBe('Space Test <space-test@example.com>');

    full = await getFullRepositoryStatus(target, executor, realFs);
    expect(full.status.branch.isInitial).toBe(false);
    expect(full.status.entries).toEqual([]);
  });

  it('unstages a file back out of the index', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    await initRepository(target, 'main', executor);
    fs.writeFileSync(path.join(target, 'a.txt'), 'x\n');
    await stageFiles(target, ['a.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'init' }, executor);

    fs.writeFileSync(path.join(target, 'a.txt'), 'y\n');
    await stageFiles(target, ['a.txt'], executor);
    let full = await getFullRepositoryStatus(target, executor, realFs);
    expect(full.status.entries[0]).toMatchObject({ indexStatus: 'M' });

    await unstageFiles(target, ['a.txt'], executor);
    full = await getFullRepositoryStatus(target, executor, realFs);
    expect(full.status.entries[0]).toMatchObject({ indexStatus: '.', worktreeStatus: 'M' });
  });
});

describe('GIT-006: branches', () => {
  async function initWithOneCommit(target: string): Promise<void> {
    fs.mkdirSync(target);
    await initRepository(target, 'main', executor);
    fs.writeFileSync(path.join(target, 'a.txt'), 'x\n');
    await stageFiles(target, ['a.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'init' }, executor);
  }

  it('creates, switches, compares, and deletes a merged branch', async () => {
    const target = path.join(dir, 'project');
    await initWithOneCommit(target);

    await createBranch(target, 'feature', undefined, executor);
    await switchBranch(target, 'feature', executor);
    fs.writeFileSync(path.join(target, 'b.txt'), 'y\n');
    await stageFiles(target, ['b.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'feature work' }, executor);

    const comparison = await compareBranches(target, 'main', 'feature', executor);
    expect(comparison.files).toHaveLength(1);
    expect(comparison.totalAdded).toBe(1);

    await switchBranch(target, 'main', executor);
    execFileSync('git', ['merge', '--no-edit', 'feature'], { cwd: target });

    expect(await isBranchMerged(target, 'feature', 'main', executor)).toBe(true);
    await deleteBranch(target, 'feature', { force: false, confirmed: true }, executor);

    const refsOutput = execFileSync('git', forEachRefArgs(), { cwd: target }).toString();
    const refs = parseForEachRefOutput(refsOutput);
    expect(refs.find((r) => r.shortName === 'feature')).toBeUndefined();
  });

  it('refuses to delete an unmerged branch without -D, and refuses -D without confirmation', async () => {
    const target = path.join(dir, 'project');
    await initWithOneCommit(target);
    await createBranch(target, 'unmerged', undefined, executor);
    await switchBranch(target, 'unmerged', executor);
    fs.writeFileSync(path.join(target, 'c.txt'), 'z\n');
    await stageFiles(target, ['c.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'unmerged work' }, executor);
    await switchBranch(target, 'main', executor);

    expect(await isBranchMerged(target, 'unmerged', 'main', executor)).toBe(false);
    await expect(deleteBranch(target, 'unmerged', { force: false, confirmed: true }, executor)).rejects.toThrow();
    await expect(
      deleteBranch(target, 'unmerged', { force: true, confirmed: false }, executor),
    ).rejects.toThrow(DestructiveGitActionNotConfirmedError);
    await expect(deleteBranch(target, 'unmerged', { force: true, confirmed: true }, executor)).resolves.not.toThrow();
  });
});

describe('GIT-008: conflicts — real merge conflict, continue, and abort', () => {
  async function makeConflictingRepo(): Promise<string> {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    await initRepository(target, 'main', executor);
    // The raw `git merge` invocation below (simulating a merge trigger not
    // yet part of the structured command surface) needs a local identity
    // to write a merge commit — Space's own identity resolution deliberately
    // never persists one (spec 11.6), so this is test-fixture setup only.
    execFileSync('git', ['config', 'user.email', workspaceIdentity.email], { cwd: target });
    execFileSync('git', ['config', 'user.name', workspaceIdentity.name], { cwd: target });
    fs.writeFileSync(path.join(target, 'a.txt'), 'base\n');
    await stageFiles(target, ['a.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'base' }, executor);

    await createBranch(target, 'feature', undefined, executor);
    await switchBranch(target, 'feature', executor);
    fs.writeFileSync(path.join(target, 'a.txt'), 'feature change\n');
    await stageFiles(target, ['a.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'feature change' }, executor);

    await switchBranch(target, 'main', executor);
    fs.writeFileSync(path.join(target, 'a.txt'), 'main change\n');
    await stageFiles(target, ['a.txt'], executor);
    await runCommit(target, { identity: workspaceIdentity, message: 'main change' }, executor);

    try {
      execFileSync('git', ['merge', '--no-edit', 'feature'], { cwd: target, stdio: 'pipe' });
    } catch {
      // Expected: the merge stops with a conflict.
    }
    return target;
  }

  it('represents the conflict explicitly and resolves + continues to a real completed merge', async () => {
    const target = await makeConflictingRepo();
    let full = await getFullRepositoryStatus(target, executor, realFs);
    expect(full.operationState).toEqual({ kind: 'merge' });
    let conflictState = deriveConflictState(full.status, full.operationState);
    expect(conflictState.inConflict).toBe(true);
    expect(conflictState.conflictedFiles).toEqual(['a.txt']);

    fs.writeFileSync(path.join(target, 'a.txt'), 'resolved\n');
    await stageFiles(target, ['a.txt'], executor);

    const outcome = await continueOperation(target, path.join(target, '.git'), full.operationState, executor, realFs);
    expect(outcome.completed).toBe(true);
    expect(outcome.remaining).toEqual({ kind: 'none' });

    full = await getFullRepositoryStatus(target, executor, realFs);
    conflictState = deriveConflictState(full.status, full.operationState);
    expect(conflictState.inConflict).toBe(false);
    expect(fs.readFileSync(path.join(target, 'a.txt'), 'utf-8')).toBe('resolved\n');
  });

  it('safely aborts a conflicted merge back to the pre-merge state', async () => {
    const target = await makeConflictingRepo();
    const beforeAbortSha = execFileSync('git', ['rev-parse', 'main'], { cwd: target }).toString().trim();
    const full = await getFullRepositoryStatus(target, executor, realFs);

    const outcome = await abortOperation(target, path.join(target, '.git'), full.operationState, executor, realFs);
    expect(outcome.completed).toBe(true);

    const afterAbortSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
    expect(afterAbortSha).toBe(beforeAbortSha);
    const state = await detectRepositoryOperationState(path.join(target, '.git'), realFs);
    expect(state).toEqual({ kind: 'none' });
  });
});

describe('GIT-007: fetch, pull, and push against a local bare "remote"', () => {
  async function makeBareRemoteWithClone(): Promise<{ bare: string; clone: string }> {
    const bare = path.join(dir, 'remote.git');
    fs.mkdirSync(bare);
    execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main'], { cwd: bare });

    const clone = path.join(dir, 'clone');
    fs.mkdirSync(clone);
    execFileSync('git', ['clone', '-q', bare, clone]);
    execFileSync('git', ['config', 'user.email', workspaceIdentity.email], { cwd: clone });
    execFileSync('git', ['config', 'user.name', workspaceIdentity.name], { cwd: clone });
    fs.writeFileSync(path.join(clone, 'a.txt'), 'x\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: clone });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: clone });
    return { bare, clone };
  }

  it('pushes with an explicit set-upstream, then a second clone can fetch and pull it', async () => {
    const { bare, clone } = await makeBareRemoteWithClone();
    await pushToRemote(clone, { branch: 'main', setUpstream: true }, executor);

    const secondClone = path.join(dir, 'clone-2');
    fs.mkdirSync(secondClone);
    execFileSync('git', ['clone', '-q', bare, secondClone]);

    fs.writeFileSync(path.join(clone, 'b.txt'), 'y\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: clone });
    execFileSync('git', ['commit', '-q', '-m', 'second commit'], { cwd: clone });
    await pushToRemote(clone, { branch: 'main' }, executor);

    await fetchRemote(secondClone, 'origin', executor);
    const remoteRefs = execFileSync('git', ['log', 'origin/main', '--oneline'], { cwd: secondClone }).toString();
    expect(remoteRefs).toContain('second commit');

    await pullRemote(secondClone, 'merge', 'origin', 'main', executor);
    expect(fs.existsSync(path.join(secondClone, 'b.txt'))).toBe(true);
  });

  it('requires confirmation before a force-with-lease push, and a plain push needs none', async () => {
    const { clone } = await makeBareRemoteWithClone();
    await expect(pushToRemote(clone, { branch: 'main', force: 'with-lease' }, executor)).rejects.toThrow(
      DestructiveGitActionNotConfirmedError,
    );
    await expect(pushToRemote(clone, { branch: 'main', setUpstream: true }, executor)).resolves.toBeTruthy();
  });
});
