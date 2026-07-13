import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUnifiedDiff, type FileDiff } from '@space/git-engine';
import {
  buildSelectionsFromFileDiffs,
  composePatchFromSelections,
  detectStaleSelections,
  isSelectionStale,
  narrowSelectionToLines,
  StaleSelectionError,
  type DiffLookup,
} from './diff-selection';

function lookupFrom(unstaged: readonly FileDiff[], staged: readonly FileDiff[] = []): DiffLookup {
  return {
    fileDiff: (filePath, state) => (state === 'staged' ? staged : unstaged).find((f) => f.path === filePath) ?? null,
  };
}

const TWO_FILE_PATCH = [
  'diff --git a/a.txt b/a.txt',
  'index e69de29..b1e6722 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old',
  '+new',
  'diff --git a/b.txt b/b.txt',
  'index e69de29..b1e6722 100644',
  '--- a/b.txt',
  '+++ b/b.txt',
  '@@ -1 +1 @@',
  '-p',
  '+q',
  '',
].join('\n');

describe('buildSelectionsFromFileDiffs', () => {
  it('produces one whole-hunk selection per hunk, skipping binary files', () => {
    const files = parseUnifiedDiff(TWO_FILE_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    expect(selections).toHaveLength(2);
    expect(selections[0]).toMatchObject({ filePath: 'a.txt', staged: 'unstaged', hunkIndex: 0, selectedLineIndexes: null });
    expect(selections[1]).toMatchObject({ filePath: 'b.txt', staged: 'unstaged', hunkIndex: 0 });
  });

  it('excludes binary files from evidence entirely', () => {
    const binaryPatch = [
      'diff --git a/img.png b/img.png',
      'index aaa..bbb 100644',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(binaryPatch);
    expect(buildSelectionsFromFileDiffs(files, 'unstaged')).toEqual([]);
  });
});

describe('isSelectionStale / detectStaleSelections', () => {
  it('is not stale when the diff is unchanged', () => {
    const files = parseUnifiedDiff(TWO_FILE_PATCH);
    const [selection] = buildSelectionsFromFileDiffs(files, 'unstaged');
    expect(isSelectionStale(selection as never, lookupFrom(files))).toBe(false);
  });

  it('is stale when the file no longer appears in a fresh diff (e.g. already committed)', () => {
    const files = parseUnifiedDiff(TWO_FILE_PATCH);
    const [selection] = buildSelectionsFromFileDiffs(files, 'unstaged');
    expect(isSelectionStale(selection as never, lookupFrom([]))).toBe(true);
  });

  it('is stale when the hunk content has changed since the evidence was collected', () => {
    const files = parseUnifiedDiff(TWO_FILE_PATCH);
    const [selection] = buildSelectionsFromFileDiffs(files, 'unstaged');
    const changedPatch = TWO_FILE_PATCH.replace('+new', '+something-else');
    const changedFiles = parseUnifiedDiff(changedPatch);
    expect(isSelectionStale(selection as never, lookupFrom(changedFiles))).toBe(true);
  });

  it('partitions a mixed set into stale and fresh', () => {
    const files = parseUnifiedDiff(TWO_FILE_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    // Only a.txt survives in the "fresh" lookup (b.txt was e.g. already committed).
    const onlyA = files.filter((f) => f.path === 'a.txt');
    const report = detectStaleSelections(selections, lookupFrom(onlyA));
    expect(report.fresh.map((s) => s.filePath)).toEqual(['a.txt']);
    expect(report.stale.map((s) => s.filePath)).toEqual(['b.txt']);
  });
});

describe('composePatchFromSelections + real git apply round-trip', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-agent-diffsel-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep\nold\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'p\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function currentUnstagedDiff(): FileDiff[] {
    const raw = execFileSync('git', ['diff', '--no-ext-diff', '--binary'], { cwd: dir }).toString();
    return parseUnifiedDiff(raw);
  }

  it('composes a multi-file patch from whole-hunk selections and stages it for real', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep\nnew\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'q\n');
    const files = currentUnstagedDiff();
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');

    const patchText = composePatchFromSelections(selections, lookupFrom(files));
    fs.writeFileSync(path.join(dir, 'out.diff'), patchText);
    execFileSync('git', ['apply', '--cached', path.join(dir, 'out.diff')], { cwd: dir });

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString().trim().split('\n');
    expect(staged.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('composes a patch from a line-level narrowed selection', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep\nnew\n');
    const files = currentUnstagedDiff();
    const [selection] = buildSelectionsFromFileDiffs(files, 'unstaged');
    if (!selection) throw new Error('expected a selection');
    const file = files[0];
    const hunk = file?.hunks[0];
    if (!file || !hunk) throw new Error('expected file/hunk');
    const addIndex = hunk.lines.findIndex((l) => l.type === 'add');
    const removeIndex = hunk.lines.findIndex((l) => l.type === 'remove');
    const narrowed = narrowSelectionToLines(selection, [addIndex, removeIndex]);

    const patchText = composePatchFromSelections([narrowed], lookupFrom(files));
    fs.writeFileSync(path.join(dir, 'out.diff'), patchText);
    execFileSync('git', ['apply', '--cached', path.join(dir, 'out.diff')], { cwd: dir });

    const cachedShow = execFileSync('git', ['show', ':a.txt'], { cwd: dir }).toString();
    expect(cachedShow).toBe('keep\nnew\n');
  });

  it('throws StaleSelectionError rather than composing from evidence that no longer matches the real diff', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep\nnew\n');
    const files = currentUnstagedDiff();
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');

    // Simulate the file changing again after evidence was collected but before composition.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'keep\nsomething-totally-different\n');
    const freshFiles = currentUnstagedDiff();

    expect(() => composePatchFromSelections(selections, lookupFrom(freshFiles))).toThrow(StaleSelectionError);
  });
});
