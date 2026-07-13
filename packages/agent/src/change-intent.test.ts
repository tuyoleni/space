import { beforeEach, describe, expect, it } from 'vitest';
import type { DiffSelection } from './diff-selection';
import {
  ChangeIntentSchema,
  generateRuleBasedIntentGroups,
  IntentGroupNotFoundError,
  isLowConfidence,
  mergeIntentGroups,
  renameIntentGroup,
  resetRuleGroupIdCounterForTests,
  resetUserGroupIdCounterForTests,
  setIntentGroupIncluded,
  splitIntentGroup,
  type ChangeIntent,
} from './change-intent';

function selection(overrides: Partial<DiffSelection> & { filePath: string }): DiffSelection {
  return {
    oldPath: null,
    staged: 'unstaged',
    hunkHeader: '@@ -1 +1 @@',
    hunkIndex: 0,
    lineRange: { startLine: 1, endLine: 1 },
    selectedLineIndexes: null,
    contentSnapshot: 'context:x',
    ...overrides,
  };
}

beforeEach(() => {
  resetRuleGroupIdCounterForTests();
  resetUserGroupIdCounterForTests();
});

describe('ChangeIntentSchema', () => {
  it('accepts a well-formed intent group', () => {
    const group: ChangeIntent = {
      id: 'g1',
      title: 'Update a.txt',
      explanation: '1 hunk changed.',
      confidence: 1,
      evidence: [selection({ filePath: 'a.txt' })],
      included: true,
      generatedBy: 'rule',
    };
    expect(ChangeIntentSchema.safeParse(group).success).toBe(true);
  });

  it('rejects a confidence outside [0, 1]', () => {
    const group = {
      id: 'g1',
      title: 't',
      explanation: 'e',
      confidence: 1.5,
      evidence: [selection({ filePath: 'a.txt' })],
      included: true,
      generatedBy: 'rule',
    };
    expect(ChangeIntentSchema.safeParse(group).success).toBe(false);
  });

  it('rejects an unknown generatedBy value', () => {
    const group = {
      id: 'g1',
      title: 't',
      explanation: 'e',
      confidence: 0.5,
      evidence: [selection({ filePath: 'a.txt' })],
      included: true,
      generatedBy: 'robot',
    };
    expect(ChangeIntentSchema.safeParse(group).success).toBe(false);
  });
});

describe('isLowConfidence', () => {
  it('flags anything below the threshold', () => {
    expect(isLowConfidence({ confidence: 0.5 })).toBe(true);
    expect(isLowConfidence({ confidence: 0.6 })).toBe(false);
    expect(isLowConfidence({ confidence: 1 })).toBe(false);
  });
});

describe('generateRuleBasedIntentGroups', () => {
  it('gives a single-file single-hunk change full confidence and its own group', () => {
    const groups = generateRuleBasedIntentGroups([selection({ filePath: 'README.md' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: 'Update README.md', confidence: 1, generatedBy: 'rule', included: true });
    expect(groups[0]?.evidence).toHaveLength(1);
  });

  it('lowers confidence for a single file with multiple hunks, but keeps it one group', () => {
    const groups = generateRuleBasedIntentGroups([
      selection({ filePath: 'a.txt', hunkIndex: 0, hunkHeader: '@@ -1 +1 @@' }),
      selection({ filePath: 'a.txt', hunkIndex: 1, hunkHeader: '@@ -10 +10 @@' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.confidence).toBe(0.75);
    expect(groups[0]?.evidence).toHaveLength(2);
  });

  it('merges files under the same non-root directory into one low-confidence group', () => {
    const groups = generateRuleBasedIntentGroups([
      selection({ filePath: 'src/a.ts' }),
      selection({ filePath: 'src/b.ts' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Changes in src/');
    expect(isLowConfidence(groups[0] as ChangeIntent)).toBe(true);
  });

  it('keeps root-level files as separate groups rather than merging them under ""', () => {
    const groups = generateRuleBasedIntentGroups([
      selection({ filePath: 'package.json' }),
      selection({ filePath: 'README.md' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.title).sort()).toEqual(['Update README.md', 'Update package.json']);
  });

  it('produces evidence that traces back exactly to the input selections (no fabrication)', () => {
    const evidence = [selection({ filePath: 'a.txt' }), selection({ filePath: 'src/b.ts' })];
    const groups = generateRuleBasedIntentGroups(evidence);
    const allGroupedEvidence = groups.flatMap((g) => g.evidence);
    expect(allGroupedEvidence).toHaveLength(evidence.length);
    for (const e of evidence) {
      expect(allGroupedEvidence).toContain(e);
    }
  });

  it('is deterministic: same input produces the same groups (ignoring generated ids)', () => {
    const evidence = [selection({ filePath: 'a.txt' }), selection({ filePath: 'src/b.ts' }), selection({ filePath: 'src/c.ts' })];
    resetRuleGroupIdCounterForTests();
    const first = generateRuleBasedIntentGroups(evidence).map(({ id: _id, ...rest }) => rest);
    resetRuleGroupIdCounterForTests();
    const second = generateRuleBasedIntentGroups(evidence).map(({ id: _id, ...rest }) => rest);
    expect(first).toEqual(second);
  });
});

describe('include/exclude and rename transitions', () => {
  it('setIntentGroupIncluded toggles only the targeted group', () => {
    const groups = generateRuleBasedIntentGroups([selection({ filePath: 'a.txt' }), selection({ filePath: 'b.txt' })]);
    const [first, second] = groups;
    const updated = setIntentGroupIncluded(groups, first!.id, false);
    expect(updated.find((g) => g.id === first!.id)?.included).toBe(false);
    expect(updated.find((g) => g.id === second!.id)?.included).toBe(true);
  });

  it('renameIntentGroup updates the title and marks the group user-modified', () => {
    const groups = generateRuleBasedIntentGroups([selection({ filePath: 'a.txt' })]);
    const renamed = renameIntentGroup(groups, groups[0]!.id, 'My custom title');
    expect(renamed[0]?.title).toBe('My custom title');
    expect(renamed[0]?.generatedBy).toBe('user');
  });

  it('throws IntentGroupNotFoundError for an unknown id', () => {
    expect(() => renameIntentGroup([], 'missing', 'x')).toThrow(IntentGroupNotFoundError);
    expect(() => setIntentGroupIncluded([], 'missing', true)).toThrow(IntentGroupNotFoundError);
  });
});

describe('mergeIntentGroups', () => {
  it('combines evidence from all merged groups into one new group and removes the originals', () => {
    const groups = generateRuleBasedIntentGroups([selection({ filePath: 'a.txt' }), selection({ filePath: 'b.txt' })]);
    const merged = mergeIntentGroups(groups, groups.map((g) => g.id), 'Combined change');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Combined change');
    expect(merged[0]?.evidence).toHaveLength(2);
    expect(merged[0]?.generatedBy).toBe('user');
  });

  it('takes the minimum confidence of the merged groups', () => {
    const groups: ChangeIntent[] = [
      { id: 'g1', title: 't1', explanation: 'e', confidence: 1, evidence: [selection({ filePath: 'a.txt' })], included: true, generatedBy: 'rule' },
      { id: 'g2', title: 't2', explanation: 'e', confidence: 0.5, evidence: [selection({ filePath: 'b.txt' })], included: true, generatedBy: 'rule' },
    ];
    const merged = mergeIntentGroups(groups, ['g1', 'g2']);
    expect(merged[0]?.confidence).toBe(0.5);
  });

  it('requires at least two ids', () => {
    expect(() => mergeIntentGroups([], ['only-one'])).toThrow(/at least two/);
  });
});

describe('splitIntentGroup', () => {
  it('splits selected evidence indexes into a new group, leaving the rest in place', () => {
    const evidence = [selection({ filePath: 'a.txt', hunkIndex: 0 }), selection({ filePath: 'a.txt', hunkIndex: 1 })];
    const groups: ChangeIntent[] = [
      { id: 'g1', title: 'Update a.txt', explanation: 'e', confidence: 0.75, evidence, included: true, generatedBy: 'rule' },
    ];
    const split = splitIntentGroup(groups, 'g1', [1], 'Second hunk');
    expect(split).toHaveLength(2);
    const original = split.find((g) => g.id === 'g1');
    const created = split.find((g) => g.id !== 'g1');
    expect(original?.evidence).toHaveLength(1);
    expect(original?.evidence[0]).toBe(evidence[0]);
    expect(created?.evidence).toHaveLength(1);
    expect(created?.evidence[0]).toBe(evidence[1]);
    expect(created?.title).toBe('Second hunk');
    expect(created?.generatedBy).toBe('user');
  });

  it('rejects splitting off all evidence (would leave the original group empty)', () => {
    const groups: ChangeIntent[] = [
      { id: 'g1', title: 't', explanation: 'e', confidence: 1, evidence: [selection({ filePath: 'a.txt' })], included: true, generatedBy: 'rule' },
    ];
    expect(() => splitIntentGroup(groups, 'g1', [0])).toThrow();
  });

  it('rejects an empty index list', () => {
    const groups: ChangeIntent[] = [
      {
        id: 'g1',
        title: 't',
        explanation: 'e',
        confidence: 1,
        evidence: [selection({ filePath: 'a.txt' }), selection({ filePath: 'b.txt' })],
        included: true,
        generatedBy: 'rule',
      },
    ];
    expect(() => splitIntentGroup(groups, 'g1', [])).toThrow();
  });
});
