import { describe, expect, it } from 'vitest';
import { detectRepositoryOperationState, type GitDirFsPort } from './repository-state';

function fakeFs(present: readonly string[]): GitDirFsPort {
  const set = new Set(present);
  return { exists: async (path: string) => set.has(path) };
}

describe('detectRepositoryOperationState', () => {
  it('reports none for a clean repository', async () => {
    expect(await detectRepositoryOperationState('.git', fakeFs([]))).toEqual({ kind: 'none' });
  });

  it('detects a merge in progress', async () => {
    expect(await detectRepositoryOperationState('.git', fakeFs(['.git/MERGE_HEAD']))).toEqual({ kind: 'merge' });
  });

  it('detects an interactive rebase', async () => {
    const fs = fakeFs(['.git/rebase-merge', '.git/rebase-merge/interactive']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'rebase', interactive: true });
  });

  it('detects a non-interactive rebase via rebase-apply/rebasing', async () => {
    const fs = fakeFs(['.git/rebase-apply', '.git/rebase-apply/rebasing']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'rebase', interactive: false });
  });

  it('distinguishes a plain `git am` from a rebase using rebase-apply', async () => {
    const fs = fakeFs(['.git/rebase-apply']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'am' });
  });

  it('detects a cherry-pick in progress, with sequencer state', async () => {
    const fs = fakeFs(['.git/CHERRY_PICK_HEAD', '.git/sequencer/todo']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'cherry-pick', sequencer: true });
  });

  it('detects a revert in progress', async () => {
    const fs = fakeFs(['.git/REVERT_HEAD']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'revert', sequencer: false });
  });

  it('detects a bisect in progress', async () => {
    const fs = fakeFs(['.git/BISECT_LOG']);
    expect(await detectRepositoryOperationState('.git', fs)).toEqual({ kind: 'bisect' });
  });
});
