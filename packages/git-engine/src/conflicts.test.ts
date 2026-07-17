import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import { createNodeGitExecutor } from './node-git-executor';
import type { GitDirFsPort } from './repository-state';
import { abortOperation, continueOperation, deriveConflictState, mergeBranch, resolveConflict } from './conflicts';
import { createNodeGitDirFs } from './node-git-dir-fs';
import type { RepositoryStatus } from './status/types';

function statusWithUnmerged(paths: readonly string[]): RepositoryStatus {
  return {
    branch: { headCommit: 'abc', isInitial: false, branchName: 'main', detached: false, upstream: null, ahead: null, behind: null },
    entries: paths.map((path) => ({
      kind: 'unmerged' as const,
      path,
      conflictCode: 'UU',
      submodule: { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false },
    })),
  };
}

describe('deriveConflictState', () => {
  it('reports no conflict for a clean status', () => {
    const status = statusWithUnmerged([]);
    const state = deriveConflictState(status, { kind: 'none' });
    expect(state).toEqual({ inConflict: false, operation: { kind: 'none' }, conflictedFiles: [] });
  });

  it('reports conflicted files from unmerged status entries', () => {
    const status = statusWithUnmerged(['a.txt', 'b.txt']);
    const state = deriveConflictState(status, { kind: 'merge' });
    expect(state.inConflict).toBe(true);
    expect(state.conflictedFiles).toEqual(['a.txt', 'b.txt']);
  });
});

describe('continueOperation', () => {
  it('runs merge --continue and confirms completion by re-checking git-dir state, not exit code alone', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: 'merged', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async () => false }; // no MERGE_HEAD left -> completed
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'merge' }, executor, gitDirFs);
    expect(executor).toHaveBeenCalledWith(['merge', '--continue'], { cwd: '/repo' });
    expect(outcome.completed).toBe(true);
  });

  it('does not report completion when exit code is 0 but conflict markers remain (e.g. multi-step cherry-pick)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async (p) => p === '/repo/.git/CHERRY_PICK_HEAD' };
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'cherry-pick', sequencer: false }, executor, gitDirFs);
    expect(outcome.completed).toBe(false);
    expect(outcome.remaining.kind).toBe('cherry-pick');
  });

  it('does not report completion when the continue command itself failed (more conflicts remain)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'error: could not apply' }));
    const gitDirFs: GitDirFsPort = { exists: async (p) => p === '/repo/.git/rebase-merge' };
    const outcome = await continueOperation('/repo', '/repo/.git', { kind: 'rebase', interactive: false }, executor, gitDirFs);
    expect(outcome.completed).toBe(false);
  });

  it('throws when no continuable operation is in progress', async () => {
    const executor: GitExecutor = vi.fn();
    const gitDirFs: GitDirFsPort = { exists: async () => false };
    await expect(continueOperation('/repo', '/repo/.git', { kind: 'none' }, executor, gitDirFs)).rejects.toThrow(/No continuable/);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('abortOperation', () => {
  it('runs rebase --abort and confirms via git-dir state', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const gitDirFs: GitDirFsPort = { exists: async () => false };
    const outcome = await abortOperation('/repo', '/repo/.git', { kind: 'rebase', interactive: true }, executor, gitDirFs);
    expect(executor).toHaveBeenCalledWith(['rebase', '--abort'], { cwd: '/repo' });
    expect(outcome.completed).toBe(true);
  });
});

describe('resolveConflict', () => {
  it('checks out the chosen side then stages the path, in that order, with -- separators', async () => {
    const calls: string[][] = [];
    const executor: GitExecutor = vi.fn(async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await resolveConflict('/repo', 'a.txt', 'theirs', executor);
    expect(calls).toEqual([
      ['checkout', '--theirs', '--', 'a.txt'],
      ['add', '--', 'a.txt'],
    ]);
  });

  it('throws (and does not stage) when the checkout fails', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: "error: path 'a.txt' does not have our version" }));
    await expect(resolveConflict('/repo', 'a.txt', 'ours', executor)).rejects.toThrow(/does not have our version/);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe('resolveConflict against a real merge conflict', () => {
  let dir: string;
  let git: GitExecutor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-conflict-'));
    git = createNodeGitExecutor();
    const run = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir });
    };
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'fixture@space.test');
    run('config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'base');
    // ours: main
    fs.writeFileSync(path.join(dir, 'a.txt'), 'ours change\n');
    run('commit', '-q', '-am', 'ours');
    // theirs: feature branched from base
    run('checkout', '-q', '-b', 'feature', 'HEAD~1');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'theirs change\n');
    run('commit', '-q', '-am', 'theirs');
    run('checkout', '-q', 'main');
    // conflict
    expect(() => run('merge', 'feature')).toThrow();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('taking ours writes our version and clears the file from the unmerged set', async () => {
    await resolveConflict(dir, 'a.txt', 'ours', git);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8')).toBe('ours change\n');
    const unmerged = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: dir }).toString().trim();
    expect(unmerged).toBe('');
  });

  it('taking theirs writes their version', async () => {
    await resolveConflict(dir, 'a.txt', 'theirs', git);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8')).toBe('theirs change\n');
  });
});

describe('mergeBranch against a real repository', () => {
  let dir: string;
  let git: GitExecutor;
  let gitDirFs: GitDirFsPort;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-merge-'));
    git = createNodeGitExecutor();
    gitDirFs = createNodeGitDirFs();
    const run = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir });
    };
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'fixture@space.test');
    run('config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'base');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws without running git when not confirmed', async () => {
    const spy = vi.fn(git);
    await expect(
      mergeBranch(dir, path.join(dir, '.git'), 'anything', { confirmed: false }, spy, gitDirFs),
    ).rejects.toThrow(/not confirmed/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cleanly merges a non-conflicting branch and reports completed', async () => {
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'b.txt'), 'new file\n');
    execFileSync('git', ['add', 'b.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'add b.txt'], { cwd: dir });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });

    const outcome = await mergeBranch(dir, path.join(dir, '.git'), 'feature', { confirmed: true }, git, gitDirFs);
    expect(outcome.completed).toBe(true);
    expect(outcome.remaining.kind).toBe('none');
    expect(fs.existsSync(path.join(dir, 'b.txt'))).toBe(true);
  });

  it('stops with real conflicts rather than throwing, leaving a merge genuinely in progress', async () => {
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'feature change\n');
    execFileSync('git', ['commit', '-q', '-am', 'change on feature'], { cwd: dir });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'main change\n');
    execFileSync('git', ['commit', '-q', '-am', 'change on main'], { cwd: dir });

    const outcome = await mergeBranch(dir, path.join(dir, '.git'), 'feature', { confirmed: true }, git, gitDirFs);
    expect(outcome.completed).toBe(false);
    expect(outcome.remaining.kind).toBe('merge');
    const unmerged = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: dir }).toString().trim();
    expect(unmerged).toBe('a.txt');
  });

  it('throws a real error, rather than silently reporting completed, when the branch does not exist', async () => {
    await expect(
      mergeBranch(dir, path.join(dir, '.git'), 'does-not-exist', { confirmed: true }, git, gitDirFs),
    ).rejects.toThrow(/git merge failed/);
  });
});
