/**
 * M5 history/graph and watcher coverage against real repositories and a
 * real filesystem watcher (spec sections 12, 11.12). The P0-D spike
 * already proved the parser/lane algorithm at 100,000 commits
 * (tests/integration/p0d-git-graph.test.ts); this file covers the cases
 * spec 11.3.3 calls out that a synthetic fast-import history doesn't
 * naturally exercise: shallow clones, replace refs, tags, and detached
 * HEAD, plus HistoryStore's real disk cache and the real filesystem
 * watcher (fs.watch), never left running after a test.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HistoryStore,
  createFsHistoryCache,
  createNodeGitExecutor,
  forEachRefArgs,
  historyLogArgs,
  parseForEachRefOutput,
  parseHistoryOutput,
  startRepositoryWatcher,
  type GitExecutor,
  type WatchHandle,
} from '@space/git-engine';

const executor: GitExecutor = createNodeGitExecutor();

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m5-history-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function commit(target: string, file: string, content: string, message: string): void {
  fs.writeFileSync(path.join(target, file), content);
  execFileSync('git', ['add', file], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: target });
}

describe('history parser against real repositories (spec 11.3.3)', () => {
  it('parses a repository with lightweight and annotated tags', () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    commit(target, 'a.txt', '1\n', 'first');
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: target });
    commit(target, 'a.txt', '2\n', 'second');
    execFileSync('git', ['tag', '-a', 'v0.2.0', '-m', 'release 0.2.0'], { cwd: target });

    const log = execFileSync('git', historyLogArgs(), { cwd: target, encoding: 'utf-8' });
    const commits = parseHistoryOutput(log);
    expect(commits).toHaveLength(2);
    const tagged = commits.find((c) => c.refs.some((r) => r.kind === 'tag'));
    expect(tagged?.refs.some((r) => r.name === 'v0.2.0')).toBe(true);

    const refsOutput = execFileSync('git', forEachRefArgs(), { cwd: target, encoding: 'utf-8' });
    const refs = parseForEachRefOutput(refsOutput);
    const tagNames = refs.filter((r) => r.kind === 'tag').map((r) => r.shortName).sort();
    expect(tagNames).toEqual(['v0.1.0', 'v0.2.0']);
    const annotated = refs.find((r) => r.shortName === 'v0.2.0');
    expect(annotated?.peeledSha).not.toBeNull();
    const lightweight = refs.find((r) => r.shortName === 'v0.1.0');
    expect(lightweight?.peeledSha).toBeNull();
  });

  it('parses history from a detached HEAD', () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    commit(target, 'a.txt', '1\n', 'first');
    commit(target, 'a.txt', '2\n', 'second');
    const firstSha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: target }).toString().trim();
    execFileSync('git', ['checkout', '-q', firstSha], { cwd: target });

    const log = execFileSync('git', historyLogArgs(), { cwd: target, encoding: 'utf-8' });
    const commits = parseHistoryOutput(log);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    // Detached HEAD is real regardless of what the parser sees in --decorate
    // output for reachable-but-not-checked-out commits; confirm via status.
    const headStatus = execFileSync('git', ['status', '--porcelain=v2', '--branch'], { cwd: target, encoding: 'utf-8' });
    expect(headStatus).toContain('# branch.head (detached)');
  });

  it('parses log output from a shallow clone without crashing on truncated parent history', () => {
    const source = path.join(dir, 'source');
    fs.mkdirSync(source);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: source });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: source });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: source });
    for (let i = 0; i < 5; i += 1) {
      commit(source, 'a.txt', `${i}\n`, `commit ${i}`);
    }

    const shallow = path.join(dir, 'shallow');
    // A bare local-path source makes git silently ignore --depth (it takes
    // the local-clone hardlink fast path instead); a file:// URL forces the
    // real network-style shallow-clone transport so --depth is honored.
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, shallow]);

    const log = execFileSync('git', historyLogArgs(), { cwd: shallow, encoding: 'utf-8' });
    const commits = parseHistoryOutput(log);
    // A depth-1 shallow clone has exactly one commit, and git reports it
    // with no parents even though the real history has more (grafted).
    expect(commits).toHaveLength(1);
    expect(commits[0]?.parents).toEqual([]);
    expect(commits[0]?.subject).toBe('commit 4');
  });

  it('honors a real replace ref in log output, and for-each-ref never surfaces refs/replace/*', () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    commit(target, 'a.txt', '1\n', 'original message');
    const originalSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
    commit(target, 'a.txt', '2\n', 'second');

    // Build a replacement commit object for `originalSha` on a throwaway
    // branch, then register it as a real refs/replace/* entry.
    execFileSync('git', ['checkout', '-q', '-b', 'replace-tmp', originalSha], { cwd: target });
    execFileSync('git', ['commit', '--amend', '-q', '-m', 'replaced message'], { cwd: target });
    const replacementSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: target });
    execFileSync('git', ['branch', '-D', 'replace-tmp'], { cwd: target });
    execFileSync('git', ['replace', originalSha, replacementSha], { cwd: target });

    const refsOutput = execFileSync('git', forEachRefArgs(), { cwd: target, encoding: 'utf-8' });
    const refs = parseForEachRefOutput(refsOutput);
    expect(refs.every((r) => !r.refname.startsWith('refs/replace/'))).toBe(true);

    const log = execFileSync('git', historyLogArgs(), { cwd: target, encoding: 'utf-8' });
    const commits = parseHistoryOutput(log);
    expect(commits.some((c) => c.subject === 'replaced message')).toBe(true);
    expect(commits.some((c) => c.subject === 'original message')).toBe(false);
  });
});

describe('HistoryStore against a real repository, including disk cache round-trip', () => {
  it('paginates a real ~40-commit repository and reaches fullyIndexed', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    for (let i = 0; i < 40; i += 1) {
      commit(target, 'a.txt', `${i}\n`, `commit ${i}`);
    }

    const store = new HistoryStore({ cwd: target, repoKey: 'repo', executor, pageSize: 10 });
    const first = await store.loadInitial(10);
    expect(first.commits).toHaveLength(10);
    expect(first.commits[0]?.subject).toBe('commit 39');

    for (let i = 0; i < 100 && !store.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(store.isFullyIndexed).toBe(true);
    expect(store.indexedCount).toBe(40);
  });

  it('persists to a real disk cache and hydrates instantly from it on the next load', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    for (let i = 0; i < 12; i += 1) {
      commit(target, 'a.txt', `${i}\n`, `commit ${i}`);
    }

    const cacheDir = path.join(dir, 'cache');
    const cache = createFsHistoryCache(cacheDir);

    const first = new HistoryStore({ cwd: target, repoKey: 'repo', executor, cache, pageSize: 5 });
    await first.loadInitial(5);
    for (let i = 0; i < 100 && !first.isFullyIndexed; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(first.isFullyIndexed).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, 'repo.history.json'))).toBe(true);

    const second = new HistoryStore({ cwd: target, repoKey: 'repo', executor, cache, pageSize: 5 });
    const page = await second.loadInitial(5);
    expect(second.isFullyIndexed).toBe(true);
    expect(page.totalIndexed).toBe(12);
    expect(page.commits[0]?.subject).toBe('commit 11');
  });
});

describe('real repository watcher (spec 11.12), always torn down', () => {
  let handle: WatchHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('reports a worktree hint after a real file write, and a git-dir hint after a real commit', async () => {
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: target });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: target });
    fs.writeFileSync(path.join(target, 'a.txt'), '1\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: target });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: target });

    const hints: Array<'worktree' | 'git-dir'> = [];
    handle = startRepositoryWatcher(
      {
        worktreeRoot: target,
        gitDir: path.join(target, '.git'),
        debounceMs: 100,
        onChangeHint: (reason) => hints.push(reason),
      },
      {
        watch: (watchPath, options, listener) => fs.watch(watchPath, { recursive: options.recursive }, listener),
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
      },
    );

    fs.writeFileSync(path.join(target, 'b.txt'), 'new file\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hints).toContain('worktree');

    hints.length = 0;
    execFileSync('git', ['add', 'b.txt'], { cwd: target });
    execFileSync('git', ['commit', '-q', '-m', 'second'], { cwd: target });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hints).toContain('git-dir');
  });
});
