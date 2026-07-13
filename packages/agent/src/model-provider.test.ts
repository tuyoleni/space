import { beforeEach, describe, expect, it } from 'vitest';
import type { DiffSelection } from './diff-selection';
import {
  applyModelProposals,
  FakeModelProvider,
  resetModelGroupIdCounterForTests,
  type ModelProposedIntentGroup,
} from './model-provider';

function selection(filePath: string): DiffSelection {
  return {
    filePath,
    oldPath: null,
    staged: 'unstaged',
    hunkHeader: '@@ -1 +1 @@',
    hunkIndex: 0,
    lineRange: { startLine: 1, endLine: 1 },
    selectedLineIndexes: null,
    contentSnapshot: 'context:x',
  };
}

beforeEach(() => {
  resetModelGroupIdCounterForTests();
});

describe('FakeModelProvider', () => {
  it('returns only canned, pre-configured responses (no network call is made)', async () => {
    const groups: ModelProposedIntentGroup[] = [
      { title: 'Refactor auth', explanation: 'e', confidence: 0.8, filePaths: ['a.ts'] },
    ];
    const provider = new FakeModelProvider({ intentGroups: groups, commitMessage: 'refactor: auth cleanup' });
    await expect(provider.proposeIntentGroups({ disclosure: { fragments: [], excluded: [] } })).resolves.toEqual(groups);
    await expect(provider.generateCommitMessage({ disclosure: { fragments: [], excluded: [] } })).resolves.toBe(
      'refactor: auth cleanup',
    );
  });

  it('defaults to an empty proposal list and a generic commit message when unconfigured', async () => {
    const provider = new FakeModelProvider();
    await expect(provider.proposeIntentGroups({ disclosure: { fragments: [], excluded: [] } })).resolves.toEqual([]);
    await expect(provider.generateCommitMessage({ disclosure: { fragments: [], excluded: [] } })).resolves.toBe(
      'Update files',
    );
  });
});

describe('applyModelProposals', () => {
  it('re-anchors a proposal to the real evidence for its file paths', () => {
    const evidence = [selection('a.ts'), selection('b.ts')];
    const proposals: ModelProposedIntentGroup[] = [
      { title: 'Auth changes', explanation: 'e', confidence: 0.9, filePaths: ['a.ts'] },
    ];
    const groups = applyModelProposals(evidence, proposals);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.evidence).toEqual([evidence[0]]);
    expect(groups[0]?.generatedBy).toBe('model');
  });

  it('drops a proposal whose file paths do not match any real evidence, rather than fabricating a group', () => {
    const evidence = [selection('a.ts')];
    const proposals: ModelProposedIntentGroup[] = [
      { title: 'Ghost group', explanation: 'e', confidence: 0.9, filePaths: ['does-not-exist.ts'] },
    ];
    expect(applyModelProposals(evidence, proposals)).toEqual([]);
  });

  it('only includes evidence the model was actually shown, even if it claims a broader file list', () => {
    // Evidence pool only has a.ts; the model claims to cover a.ts and c.ts (c.ts was never disclosed).
    const evidence = [selection('a.ts')];
    const proposals: ModelProposedIntentGroup[] = [
      { title: 'Broad claim', explanation: 'e', confidence: 0.5, filePaths: ['a.ts', 'c.ts'] },
    ];
    const groups = applyModelProposals(evidence, proposals);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.evidence.map((e) => e.filePath)).toEqual(['a.ts']);
  });
});
