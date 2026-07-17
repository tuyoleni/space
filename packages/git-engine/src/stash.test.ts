import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import { createNodeGitExecutor } from './node-git-executor';
import { applyStash, dropStash, listStashes, parseStashList } from './stash';

const REF_FIELD_SEPARATOR = '\x1f';

describe('parseStashList', () => {
  it('reads index from the stash@{N} selector, message, branch, and ms timestamp', () => {
    const stdout = [
      `stash@{0}${REF_FIELD_SEPARATOR}1700000000${REF_FIELD_SEPARATOR}WIP on main: abc123 fix the thing`,
      `stash@{1}${REF_FIELD_SEPARATOR}1699999000${REF_FIELD_SEPARATOR}On feature/x: manual snapshot`,
    ].join('\n');
    expect(parseStashList(stdout)).toEqual([
      { index: 0, message: 'WIP on main: abc123 fix the thing', branch: 'main', createdAt: 1700000000000 },
      { index: 1, message: 'On feature/x: manual snapshot', branch: 'feature/x', createdAt: 1699999000000 },
    ]);
  });

  it('returns [] for empty output and null branch when the subject does not match', () => {
    expect(parseStashList('')).toEqual([]);
    const [entry] = parseStashList(`stash@{0}${REF_FIELD_SEPARATOR}1700000000${REF_FIELD_SEPARATOR}something unusual`);
    expect(entry?.branch).toBeNull();
  });
});

describe('listStashes / applyStash / dropStash against a real repo', () => {
  let dir: string;
  let git: GitExecutor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-stash-'));
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

  it('lists [] when there are no stashes', async () => {
    await expect(listStashes(dir, git)).resolves.toEqual([]);
  });

  it('lists a real stash with index 0 and the branch it was created on', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1 changed\n');
    execFileSync('git', ['stash', 'push', '-m', 'work in progress'], { cwd: dir });

    const stashes = await listStashes(dir, git);
    expect(stashes).toHaveLength(1);
    expect(stashes[0]?.index).toBe(0);
    expect(stashes[0]?.branch).toBe('main');
    expect(stashes[0]?.message).toContain('work in progress');
    expect(stashes[0]?.createdAt).toBeGreaterThan(0);
  });

  it('applyStash restores the change but keeps the entry; dropStash removes it', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1 changed\n');
    execFileSync('git', ['stash', 'push', '-m', 'wip'], { cwd: dir });

    const applied = await applyStash(dir, 0, git);
    expect(applied.completed).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8')).toBe('line1 changed\n');
    // apply keeps the entry
    expect(await listStashes(dir, git)).toHaveLength(1);

    await dropStash(dir, 0, git);
    expect(await listStashes(dir, git)).toHaveLength(0);
  });

  it('dropStash throws on an out-of-range index', async () => {
    await expect(dropStash(dir, 0, git)).rejects.toThrow();
  });
});

describe('applyStash outcome shaping', () => {
  it('reports completed:false without throwing when apply leaves conflicts (exit 1)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in a.txt' }));
    const outcome = await applyStash('/repo', 0, executor);
    expect(outcome.completed).toBe(false);
    expect(outcome.stderr).toContain('CONFLICT');
  });

  it('throws on a fatal exit (128), e.g. an out-of-range index', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: 'fatal: stash@{9} is not a valid reference' }));
    await expect(applyStash('/repo', 9, executor)).rejects.toThrow(/not a valid reference/);
  });
});
