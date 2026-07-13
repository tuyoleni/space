/**
 * `ChangeIntent` — the intent-group model (spec 13.2 CHG-002), and the
 * always-available, deterministic rule-based grouping implementation (spec
 * 13.3: "a local or offline grouping fallback must exist, even if less
 * sophisticated" — here it is the *default*, not a fallback for when a
 * remote model is unavailable; a model-produced grouping, if ever wired
 * up, is additive, never a replacement for this).
 */
import { z } from 'zod';
import type { DiffSelection } from './diff-selection';

export const ChangeIntentSchema = z.object({
  id: z.string(),
  title: z.string(),
  explanation: z.string(),
  userVisibleOutcome: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.unknown()).min(1),
  included: z.boolean(),
  generatedBy: z.enum(['rule', 'model', 'user']),
});

export interface ChangeIntent {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly userVisibleOutcome?: string;
  readonly confidence: number;
  readonly evidence: readonly DiffSelection[];
  readonly included: boolean;
  readonly generatedBy: 'rule' | 'model' | 'user';
}

/** Confidence below this is surfaced to the user as "low confidence" (spec 13.2: "low-confidence interpretations must be labelled"). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function isLowConfidence(intent: Pick<ChangeIntent, 'confidence'>): boolean {
  return intent.confidence < LOW_CONFIDENCE_THRESHOLD;
}

let ruleGroupCounter = 0;
function nextRuleGroupId(): string {
  ruleGroupCounter += 1;
  return `rule-group-${ruleGroupCounter}`;
}

/** Resets the deterministic id counter — test-only, so generated ids are reproducible across test runs. */
export function resetRuleGroupIdCounterForTests(): void {
  ruleGroupCounter = 0;
}

function directoryOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

function fileLabel(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

/**
 * Deterministic rule-based grouping heuristic (spec 13.3 does not mandate
 * an algorithm, only the traceability property and confidence labelling):
 *
 * 1. Evidence is bucketed per file first.
 * 2. Files that share a non-root parent directory are merged into one
 *    directory-level group; root-level files (no parent directory) stay
 *    one group each, since unrelated top-level files (e.g. `package.json`
 *    and `README.md`) are common and grouping them by "root" would be a
 *    weaker inference than grouping by a real shared directory.
 * 3. Confidence reflects how much inference the grouping required: a
 *    single file with a single hunk is unambiguous (1.0); a single file
 *    with multiple hunks is still one file but the hunks may be unrelated
 *    (0.75); a directory-level group spanning multiple files is the
 *    heaviest inference (0.5), and is always below
 *    `LOW_CONFIDENCE_THRESHOLD` so the user sees it flagged.
 */
export function generateRuleBasedIntentGroups(evidence: readonly DiffSelection[]): ChangeIntent[] {
  const byFile = new Map<string, DiffSelection[]>();
  for (const selection of evidence) {
    const existing = byFile.get(selection.filePath);
    if (existing) {
      existing.push(selection);
    } else {
      byFile.set(selection.filePath, [selection]);
    }
  }

  const byDirectory = new Map<string, string[]>();
  for (const filePath of byFile.keys()) {
    const dir = directoryOf(filePath);
    const existing = byDirectory.get(dir);
    if (existing) {
      existing.push(filePath);
    } else {
      byDirectory.set(dir, [filePath]);
    }
  }

  const groups: ChangeIntent[] = [];
  for (const [dir, filePaths] of byDirectory) {
    const isDirectoryGroup = dir !== '' && filePaths.length > 1;
    if (isDirectoryGroup) {
      const groupEvidence = filePaths.flatMap((filePath) => byFile.get(filePath) ?? []);
      groups.push({
        id: nextRuleGroupId(),
        title: `Changes in ${dir}/`,
        explanation: `${filePaths.length} files changed under "${dir}/": ${filePaths.map(fileLabel).join(', ')}.`,
        confidence: 0.5,
        evidence: groupEvidence,
        included: true,
        generatedBy: 'rule',
      });
      continue;
    }
    for (const filePath of filePaths) {
      const fileEvidence = byFile.get(filePath) ?? [];
      const confidence = fileEvidence.length <= 1 ? 1.0 : 0.75;
      groups.push({
        id: nextRuleGroupId(),
        title: `Update ${filePath}`,
        explanation:
          fileEvidence.length === 1
            ? `1 hunk changed in "${filePath}".`
            : `${fileEvidence.length} hunks changed in "${filePath}".`,
        confidence,
        evidence: fileEvidence,
        included: true,
        generatedBy: 'rule',
      });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// State transitions (spec 13.2: "the user can rename, merge, split,
// include, or exclude groups"). Each is a pure function over ChangeIntent[]
// so the renderer/tests can reason about group state without any I/O.
// ---------------------------------------------------------------------------

export class IntentGroupNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No intent group with id "${id}"`);
    this.name = 'IntentGroupNotFoundError';
  }
}

function requireGroup(groups: readonly ChangeIntent[], id: string): ChangeIntent {
  const found = groups.find((g) => g.id === id);
  if (!found) {
    throw new IntentGroupNotFoundError(id);
  }
  return found;
}

export function renameIntentGroup(groups: readonly ChangeIntent[], id: string, title: string): ChangeIntent[] {
  requireGroup(groups, id);
  return groups.map((g) => (g.id === id ? { ...g, title, generatedBy: 'user' as const } : g));
}

export function setIntentGroupIncluded(groups: readonly ChangeIntent[], id: string, included: boolean): ChangeIntent[] {
  requireGroup(groups, id);
  return groups.map((g) => (g.id === id ? { ...g, included } : g));
}

let userGroupCounter = 0;
function nextUserGroupId(): string {
  userGroupCounter += 1;
  return `user-group-${userGroupCounter}`;
}

/** Test-only: keeps merge/split ids reproducible across test runs. */
export function resetUserGroupIdCounterForTests(): void {
  userGroupCounter = 0;
}

/** Merges two or more groups' evidence into one new group (spec 13.2). Confidence is the minimum of the merged groups', reflecting that a user-forced merge is at most as certain as its least-certain input. */
export function mergeIntentGroups(
  groups: readonly ChangeIntent[],
  ids: readonly string[],
  title?: string,
): ChangeIntent[] {
  if (ids.length < 2) {
    throw new Error('mergeIntentGroups requires at least two group ids');
  }
  const toMerge = ids.map((id) => requireGroup(groups, id));
  const mergedEvidence = toMerge.flatMap((g) => g.evidence);
  const merged: ChangeIntent = {
    id: nextUserGroupId(),
    title: title ?? toMerge.map((g) => g.title).join(' + '),
    explanation: `Merged ${toMerge.length} groups: ${toMerge.map((g) => g.title).join(', ')}.`,
    confidence: Math.min(...toMerge.map((g) => g.confidence)),
    evidence: mergedEvidence,
    included: toMerge.some((g) => g.included),
    generatedBy: 'user',
  };
  const idSet = new Set(ids);
  return [...groups.filter((g) => !idSet.has(g.id)), merged];
}

/**
 * Splits `id` into two groups: evidence at `evidenceIndexes` (into the
 * original group's `evidence` array) becomes a new group; the rest stays
 * under the original id with the remaining evidence (spec 13.2).
 */
export function splitIntentGroup(
  groups: readonly ChangeIntent[],
  id: string,
  evidenceIndexes: readonly number[],
  newTitle?: string,
): ChangeIntent[] {
  const original = requireGroup(groups, id);
  if (evidenceIndexes.length === 0 || evidenceIndexes.length >= original.evidence.length) {
    throw new Error('splitIntentGroup requires a non-empty, proper subset of the group\'s evidence');
  }
  const indexSet = new Set(evidenceIndexes);
  const splitOff = original.evidence.filter((_, index) => indexSet.has(index));
  const remaining = original.evidence.filter((_, index) => !indexSet.has(index));

  const newGroup: ChangeIntent = {
    id: nextUserGroupId(),
    title: newTitle ?? `${original.title} (split)`,
    explanation: `Split from "${original.title}".`,
    confidence: original.confidence,
    evidence: splitOff,
    included: original.included,
    generatedBy: 'user',
  };
  const updatedOriginal: ChangeIntent = { ...original, evidence: remaining, generatedBy: 'user' };
  return groups.map((g) => (g.id === id ? updatedOriginal : g)).concat(newGroup);
}
