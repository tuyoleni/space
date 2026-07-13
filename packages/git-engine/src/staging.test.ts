import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import {
  applyPatchToWorktree,
  discardPatch,
  discardTrackedFiles,
  discardUntrackedFiles,
  stageFiles,
  stagePatch,
  unstageFiles,
  unstagePatch,
} from './staging';

describe('stageFiles / unstageFiles', () => {
  it('stages the given paths with -- separation', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await stageFiles('/repo', ['a.txt', 'b.txt'], executor);
    expect(executor).toHaveBeenCalledWith(['add', '--', 'a.txt', 'b.txt'], { cwd: '/repo' });
  });

  it('is a no-op for an empty path list rather than running a bare "git add"', async () => {
    const executor: GitExecutor = vi.fn();
    await stageFiles('/repo', [], executor);
    expect(executor).not.toHaveBeenCalled();
  });

  it('unstages via restore --staged', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await unstageFiles('/repo', ['a.txt'], executor);
    expect(executor).toHaveBeenCalledWith(['restore', '--staged', '--', 'a.txt'], { cwd: '/repo' });
  });

  it('throws with git stderr on failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'fatal: pathspec did not match' }));
    await expect(stageFiles('/repo', ['missing.txt'], executor)).rejects.toThrow(/pathspec did not match/);
  });
});

describe('patch-based staging (hunk/line level)', () => {
  const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';

  it('applies a patch to the index via stdin, never a shell-escaped string', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await stagePatch('/repo', patch, executor);
    expect(executor).toHaveBeenCalledWith(['apply', '--cached', '-'], { cwd: '/repo', input: patch });
  });

  it('reverse-applies a patch from the index to unstage', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await unstagePatch('/repo', patch, executor);
    expect(executor).toHaveBeenCalledWith(['apply', '--cached', '--reverse', '-'], { cwd: '/repo', input: patch });
  });

  it('discards a patch from the worktree (destructive; caller must have already confirmed)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await discardPatch('/repo', patch, executor);
    expect(executor).toHaveBeenCalledWith(['apply', '--reverse', '-'], { cwd: '/repo', input: patch });
  });

  it('applies a patch to the worktree (the file.modify agent-action mechanism, spec 19.1)', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await applyPatchToWorktree('/repo', patch, executor);
    expect(executor).toHaveBeenCalledWith(['apply', '-'], { cwd: '/repo', input: patch });
  });
});

describe('discard operations', () => {
  it('discards tracked-file changes via checkout', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await discardTrackedFiles('/repo', ['a.txt'], executor);
    expect(executor).toHaveBeenCalledWith(['checkout', '--', 'a.txt'], { cwd: '/repo' });
  });

  it('removes untracked files via clean -f', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    await discardUntrackedFiles('/repo', ['scratch.txt'], executor);
    expect(executor).toHaveBeenCalledWith(['clean', '-f', '--', 'scratch.txt'], { cwd: '/repo' });
  });
});
