import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitExecutor } from './clone';
import { createNodeGitExecutor } from './node-git-executor';
import { listWorktrees, parseWorktreePorcelain } from './worktree';

describe('parseWorktreePorcelain', () => {
  it('parses main + linked + detached records and flags current/main', () => {
    const stdout = [
      'worktree /repos/main',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repos/feature',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature/x',
      '',
      'worktree /repos/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
    ].join('\n');

    expect(parseWorktreePorcelain(stdout, '/repos/feature')).toEqual([
      { path: '/repos/main', branch: 'main', headSha: '1111111111111111111111111111111111111111', isMain: true, isCurrent: false },
      { path: '/repos/feature', branch: 'feature/x', headSha: '2222222222222222222222222222222222222222', isMain: false, isCurrent: true },
      { path: '/repos/detached', branch: null, headSha: '3333333333333333333333333333333333333333', isMain: false, isCurrent: false },
    ]);
  });

  it('matches current even with a trailing slash on the given root', () => {
    const stdout = ['worktree /repos/main', 'HEAD abc', 'branch refs/heads/main', ''].join('\n');
    expect(parseWorktreePorcelain(stdout, '/repos/main/')[0]?.isCurrent).toBe(true);
  });
});

describe('listWorktrees against a real repo', () => {
  let dir: string;
  let git: GitExecutor;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'space-wt-')));
    git = createNodeGitExecutor();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists the single main worktree, flagged as main and current', async () => {
    const worktrees = await listWorktrees(dir, dir, git);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.isMain).toBe(true);
    expect(worktrees[0]?.isCurrent).toBe(true);
    expect(worktrees[0]?.branch).toBe('main');
    expect(worktrees[0]?.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists a real linked worktree added on a new branch', async () => {
    const linked = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'space-wt-linked-')));
    fs.rmSync(linked, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/x', linked], { cwd: dir });
    try {
      const worktrees = await listWorktrees(dir, dir, git);
      expect(worktrees).toHaveLength(2);
      const feature = worktrees.find((w) => w.branch === 'feature/x');
      expect(feature).toBeDefined();
      expect(feature?.isMain).toBe(false);
      expect(feature?.isCurrent).toBe(false);
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', linked], { cwd: dir });
    }
  });
});
