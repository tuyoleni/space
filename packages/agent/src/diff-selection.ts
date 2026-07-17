/**
 * `DiffSelection` — the evidence unit `ChangeIntent.evidence` is made of
 * (spec 13.1 CHG-001: "every intent group must preserve traceability to
 * exact file paths, hunks, line ranges, and staged or unstaged state").
 * Built directly from `@space/git-engine`'s `parseUnifiedDiff` output —
 * never a re-parse of raw diff text, and never fabricated.
 */
import { renderPartialHunk, buildFilePatch, type DiffHunk, type FileDiff } from '@space/git-engine';

export type StagedState = 'staged' | 'unstaged';

export interface DiffSelection {
  readonly filePath: string;
  readonly oldPath: string | null;
  readonly staged: StagedState;
  /** Exact `@@ -a,b +c,d @@` header this evidence traces to. */
  readonly hunkHeader: string;
  readonly hunkIndex: number;
  readonly lineRange: { readonly startLine: number; readonly endLine: number };
  /**
   * `null` means the whole hunk is selected. Otherwise the indexes (into
   * the hunk's `lines` array) of the specific added/removed lines this
   * selection covers (spec 13.4: "compose a commit from ... hunks, or
   * lines").
   */
  readonly selectedLineIndexes: readonly number[] | null;
  /**
   * Verbatim snapshot of the hunk's line text at the moment this evidence
   * was collected — the only thing `isSelectionStale` compares against a
   * freshly-parsed diff (spec 13.4: "refresh the diff ... and detect stale
   * selections").
   */
  readonly contentSnapshot: string;
}

function hunkContentSnapshot(hunk: DiffHunk): string {
  return hunk.lines.map((line) => `${line.type}:${line.content}`).join('\n');
}

/**
 * Computes the new-file (or old-file, for a pure deletion) line range a
 * hunk covers — used only for human-facing display, never for patch
 * reconstruction (that always replays the hunk's own lines).
 */
function hunkLineRange(hunk: DiffHunk): { startLine: number; endLine: number } {
  if (hunk.newLines > 0) {
    return { startLine: hunk.newStart, endLine: hunk.newStart + hunk.newLines - 1 };
  }
  return { startLine: hunk.oldStart, endLine: hunk.oldStart + Math.max(hunk.oldLines - 1, 0) };
}

/**
 * Builds one whole-hunk `DiffSelection` per hunk across every non-binary
 * file in `fileDiffs` — the raw evidence pool intent grouping and manual
 * selection both start from. Binary files produce no evidence (spec 13.3:
 * binary files excluded from model disclosure; there is also nothing
 * hunk-shaped to select for a binary file in the first place).
 */
export function buildSelectionsFromFileDiffs(
  fileDiffs: readonly FileDiff[],
  staged: StagedState,
): DiffSelection[] {
  const selections: DiffSelection[] = [];
  for (const file of fileDiffs) {
    if (file.isBinary) {
      continue;
    }
    file.hunks.forEach((hunk, hunkIndex) => {
      selections.push({
        filePath: file.path,
        oldPath: file.oldPath,
        staged,
        hunkHeader: hunk.header,
        hunkIndex,
        lineRange: hunkLineRange(hunk),
        selectedLineIndexes: null,
        contentSnapshot: hunkContentSnapshot(hunk),
      });
    });
  }
  return selections;
}

/** Narrows a whole-hunk selection down to a specific subset of the hunk's line indexes (spec 13.4 line-level composition). */
export function narrowSelectionToLines(selection: DiffSelection, lineIndexes: readonly number[]): DiffSelection {
  return { ...selection, selectedLineIndexes: [...lineIndexes].sort((a, b) => a - b) };
}

export interface DiffLookup {
  /** Resolves the current parsed diff for a file at a given staged state, or `null` if the file no longer appears in that diff. */
  fileDiff(filePath: string, staged: StagedState): FileDiff | null;
}

function findHunk(file: FileDiff, selection: DiffSelection): DiffHunk | null {
  return file.hunks[selection.hunkIndex] ?? null;
}

/**
 * True when `selection`'s recorded evidence no longer matches the current
 * state of the repository (spec 13.4: "Space must refresh the diff before
 * applying a generated patch and detect stale selections"). A selection is
 * stale when its file/hunk index disappeared, or the hunk's content no
 * longer matches the snapshot taken when the evidence was collected.
 */
export function isSelectionStale(selection: DiffSelection, lookup: DiffLookup): boolean {
  const file = lookup.fileDiff(selection.filePath, selection.staged);
  if (!file) {
    return true;
  }
  const hunk = findHunk(file, selection);
  if (!hunk) {
    return true;
  }
  if (hunk.header !== selection.hunkHeader) {
    return true;
  }
  return hunkContentSnapshot(hunk) !== selection.contentSnapshot;
}

export interface StaleSelectionReport {
  readonly stale: readonly DiffSelection[];
  readonly fresh: readonly DiffSelection[];
}

/** Partitions a set of selections into still-valid and stale against a freshly loaded diff (spec 13.4). */
export function detectStaleSelections(
  selections: readonly DiffSelection[],
  lookup: DiffLookup,
): StaleSelectionReport {
  const stale: DiffSelection[] = [];
  const fresh: DiffSelection[] = [];
  for (const selection of selections) {
    (isSelectionStale(selection, lookup) ? stale : fresh).push(selection);
  }
  return { stale, fresh };
}

export class StaleSelectionError extends Error {
  constructor(public readonly stale: readonly DiffSelection[]) {
    super(
      `${stale.length} selected hunk(s) no longer match the current diff and must be refreshed before composing a patch: ${stale
        .map((s) => `${s.filePath} (${s.hunkHeader})`)
        .join(', ')}`,
    );
    this.name = 'StaleSelectionError';
  }
}

/**
 * Composes a single `git apply`-able patch text from a set of selections,
 * grouped by file (spec 13.4: "compose a commit from selected intent
 * groups, files, hunks, or lines"). Throws `StaleSelectionError` rather
 * than silently applying a patch built from evidence that no longer
 * matches the real diff — the caller must refresh and re-select first.
 */
export function composePatchFromSelections(
  selections: readonly DiffSelection[],
  lookup: DiffLookup,
): string {
  const { stale } = detectStaleSelections(selections, lookup);
  if (stale.length > 0) {
    throw new StaleSelectionError(stale);
  }

  // Only `unstaged` evidence needs a patch applied here. The caller
  // applies the resulting text via `git apply --cached`, which validates
  // hunks against the *current index* — an `unstaged` selection's "old"
  // side is exactly the index content (that's what "unstaged diff" means:
  // index vs. working tree), so it applies cleanly. A `staged` selection's
  // "old" side is HEAD content instead (staged diff: HEAD vs. index), and
  // the index has by definition already moved past that base — that's
  // what "staged" means. Re-applying it would always fail with "patch
  // does not apply", since the base content it expects no longer exists.
  // Already-staged evidence needs no action here — it's already exactly
  // where the eventual commit needs it.
  const toApply = selections.filter((selection) => selection.staged === 'unstaged');

  const byFile = new Map<string, DiffSelection[]>();
  for (const selection of toApply) {
    const key = `${selection.staged}:${selection.filePath}`;
    const existing = byFile.get(key);
    if (existing) {
      existing.push(selection);
    } else {
      byFile.set(key, [selection]);
    }
  }

  const patchParts: string[] = [];
  for (const [key, fileSelections] of byFile) {
    const [staged] = key.split(':') as [StagedState];
    const first = fileSelections[0];
    if (!first) {
      continue;
    }
    const file = lookup.fileDiff(first.filePath, staged);
    if (!file) {
      throw new StaleSelectionError(fileSelections);
    }
    const hunks = fileSelections
      .sort((a, b) => a.hunkIndex - b.hunkIndex)
      .map((selection) => {
        const hunk = findHunk(file, selection);
        if (!hunk) {
          throw new StaleSelectionError([selection]);
        }
        return selection.selectedLineIndexes === null
          ? hunk
          : renderPartialHunk(hunk, new Set(selection.selectedLineIndexes));
      });
    patchParts.push(buildFilePatch(file, hunks));
  }
  return patchParts.join('');
}
