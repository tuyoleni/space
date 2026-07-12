import { describe, expect, it, vi } from 'vitest';
import { startRepositoryWatcher, type RepositoryWatcherDeps, type WatchHandle } from './watcher';

interface FakeWatch {
  readonly deps: RepositoryWatcherDeps;
  emit(path: string, eventType: string, filename: string | null): void;
  closeCalls: { worktree: number; gitDir: number };
  advance(ms: number): void;
}

function createFakeDeps(): FakeWatch {
  const listeners = new Map<string, (eventType: string, filename: string | null) => void>();
  const closeCalls = { worktree: 0, gitDir: 0 };
  let now = 0;
  const timers: { fireAt: number; callback: () => void; id: number }[] = [];
  let nextId = 0;

  const watch = vi.fn((path: string, _options, listener) => {
    listeners.set(path, listener);
    const handle: WatchHandle = {
      close: () => {
        if (path.includes('.git')) closeCalls.gitDir += 1;
        else closeCalls.worktree += 1;
      },
    };
    return handle;
  });

  const deps: RepositoryWatcherDeps = {
    watch,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timers.push({ fireAt: now + ms, callback, id });
      return id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
  };

  return {
    deps,
    emit: (path, eventType, filename) => listeners.get(path)?.(eventType, filename),
    closeCalls,
    advance: (ms) => {
      now += ms;
      const due = timers.filter((t) => t.fireAt <= now);
      for (const t of due) {
        const idx = timers.indexOf(t);
        if (idx !== -1) timers.splice(idx, 1);
        t.callback();
      }
    },
  };
}

describe('startRepositoryWatcher', () => {
  it('watches both the worktree and the git-dir with recursive: true', () => {
    const fake = createFakeDeps();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', onChangeHint: vi.fn() }, fake.deps);
    expect(fake.deps.watch).toHaveBeenCalledWith('/repo', { recursive: true }, expect.any(Function));
    expect(fake.deps.watch).toHaveBeenCalledWith('/repo/.git', { recursive: true }, expect.any(Function));
  });

  it('debounces bursts of worktree changes into a single hint', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 100, onChangeHint }, fake.deps);

    fake.emit('/repo', 'change', 'src/a.ts');
    fake.advance(30);
    fake.emit('/repo', 'change', 'src/b.ts');
    fake.advance(30);
    fake.emit('/repo', 'change', 'src/c.ts');
    fake.advance(100);

    expect(onChangeHint).toHaveBeenCalledTimes(1);
    expect(onChangeHint).toHaveBeenCalledWith('worktree');
  });

  it('ignores changes inside ignored directories like node_modules', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 50, onChangeHint }, fake.deps);

    fake.emit('/repo', 'change', 'node_modules/pkg/index.js');
    fake.advance(50);
    expect(onChangeHint).not.toHaveBeenCalled();
  });

  it('reports a git-dir hint for HEAD/index/refs/operation-state changes', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 10, onChangeHint }, fake.deps);

    fake.emit('/repo/.git', 'change', 'HEAD');
    fake.advance(10);
    expect(onChangeHint).toHaveBeenCalledWith('git-dir');

    onChangeHint.mockClear();
    fake.emit('/repo/.git', 'change', 'refs/heads/main');
    fake.advance(10);
    expect(onChangeHint).toHaveBeenCalledWith('git-dir');

    onChangeHint.mockClear();
    fake.emit('/repo/.git', 'change', 'MERGE_HEAD');
    fake.advance(10);
    expect(onChangeHint).toHaveBeenCalledWith('git-dir');
  });

  it('ignores irrelevant git-dir noise (e.g. COMMIT_EDITMSG, FETCH_HEAD logs, lock files)', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 10, onChangeHint }, fake.deps);

    fake.emit('/repo/.git', 'change', 'COMMIT_EDITMSG');
    fake.advance(10);
    expect(onChangeHint).not.toHaveBeenCalled();
  });

  it('prioritizes a git-dir reason over a coalesced worktree reason within the same debounce window', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    startRepositoryWatcher({ worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 50, onChangeHint }, fake.deps);

    fake.emit('/repo', 'change', 'src/a.ts');
    fake.emit('/repo/.git', 'change', 'HEAD');
    fake.advance(50);

    expect(onChangeHint).toHaveBeenCalledTimes(1);
    expect(onChangeHint).toHaveBeenCalledWith('git-dir');
  });

  it('closes both underlying watchers and cancels any pending debounce timer', () => {
    const fake = createFakeDeps();
    const onChangeHint = vi.fn();
    const handle = startRepositoryWatcher(
      { worktreeRoot: '/repo', gitDir: '/repo/.git', debounceMs: 50, onChangeHint },
      fake.deps,
    );
    fake.emit('/repo', 'change', 'src/a.ts');
    handle.close();
    fake.advance(100);

    expect(onChangeHint).not.toHaveBeenCalled();
    expect(fake.closeCalls.worktree).toBe(1);
    expect(fake.closeCalls.gitDir).toBe(1);
  });
});
