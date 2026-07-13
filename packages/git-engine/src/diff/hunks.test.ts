import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFilePatch, parseUnifiedDiff, renderPartialHunk } from './hunks';

describe('parseUnifiedDiff', () => {
  it('parses a single-hunk modification with context/add/remove lines and line numbers', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index e69de29..b1e6722 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,3 @@',
      ' line1',
      '-line2',
      '+line2 modified',
      '+line3',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(patch);
    expect(file).toBeDefined();
    expect(file?.path).toBe('a.txt');
    expect(file?.oldPath).toBeNull();
    expect(file?.isBinary).toBe(false);
    expect(file?.hunks).toHaveLength(1);
    const hunk = file?.hunks[0];
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldLines).toBe(2);
    expect(hunk?.newStart).toBe(1);
    expect(hunk?.newLines).toBe(3);
    expect(hunk?.lines).toEqual([
      { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'remove', content: 'line2', oldLineNumber: 2, newLineNumber: null },
      { type: 'add', content: 'line2 modified', oldLineNumber: null, newLineNumber: 2 },
      { type: 'add', content: 'line3', oldLineNumber: null, newLineNumber: 3 },
    ]);
  });

  it('parses a new file, marking isNewFile and a null oldPath', () => {
    const patch = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..3e75765',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(patch);
    expect(file?.isNewFile).toBe(true);
    expect(file?.isDeletedFile).toBe(false);
    expect(file?.oldPath).toBeNull();
    expect(file?.path).toBe('new.txt');
    expect(file?.hunks[0]?.lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('parses a deleted file, marking isDeletedFile', () => {
    const patch = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index 3e75765..0000000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-hello',
      '-world',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(patch);
    expect(file?.isDeletedFile).toBe(true);
    expect(file?.path).toBe('old.txt');
  });

  it('parses a rename with no hunks (pure rename) and captures oldPath', () => {
    const patch = [
      'diff --git a/old.txt b/renamed.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to renamed.txt',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(patch);
    expect(file?.path).toBe('renamed.txt');
    expect(file?.oldPath).toBe('old.txt');
    expect(file?.hunks).toHaveLength(0);
  });

  it('marks a binary file diff as isBinary with no hunks', () => {
    const patch = [
      'diff --git a/img.png b/img.png',
      'index aaaaaaa..bbbbbbb 100644',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');

    const [file] = parseUnifiedDiff(patch);
    expect(file?.isBinary).toBe(true);
    expect(file?.hunks).toHaveLength(0);
  });

  it('parses multiple files in one patch stream', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index e69de29..b1e6722 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/b.txt b/b.txt',
      'index e69de29..b1e6722 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-p',
      '+q',
      '',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('renderPartialHunk', () => {
  it('drops unselected additions and converts unselected removals to context, recomputing counts', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index e69de29..b1e6722 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,4 @@',
      ' keep',
      '-remove-me',
      '+add-me-1',
      '+add-me-2',
      ' tail',
      '',
    ].join('\n');
    const [file] = parseUnifiedDiff(patch);
    const hunk = file?.hunks[0];
    if (!hunk) throw new Error('expected hunk');

    // Select only "add-me-1" (index 2) and keep "remove-me" as a removal (index 1).
    const partial = renderPartialHunk(hunk, new Set([1, 2]));
    expect(partial.lines.map((l) => `${l.type}:${l.content}`)).toEqual([
      'context:keep',
      'remove:remove-me',
      'add:add-me-1',
      'context:tail',
    ]);
    expect(partial.oldLines).toBe(3); // keep, remove-me, tail
    expect(partial.newLines).toBe(3); // keep, add-me-1, tail

    // Selecting nothing converts the removal to context and drops both additions.
    const empty = renderPartialHunk(hunk, new Set());
    expect(empty.lines.map((l) => l.type)).toEqual(['context', 'context', 'context']);
    expect(empty.header).toBe('@@ -1,3 +1,3 @@');
  });
});

describe('buildFilePatch + renderPartialHunk round-trip against real git apply', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-hunks-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\nline3\nline4\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies a whole-hunk selection to the index via `git apply --cached`', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2 changed\nline3\nline4 changed\n');
    const rawDiff = execFileSync('git', ['diff', '--no-ext-diff', '--binary'], { cwd: dir }).toString();
    const [file] = parseUnifiedDiff(rawDiff);
    if (!file) throw new Error('expected file diff');
    expect(file.hunks.length).toBeGreaterThan(0);

    const firstHunkOnly = buildFilePatch(file, [file.hunks[0] as never]);
    fs.writeFileSync(path.join(dir, 'patch.diff'), firstHunkOnly);
    execFileSync('git', ['apply', '--cached', path.join(dir, 'patch.diff')], { cwd: dir });

    const staged = execFileSync('git', ['diff', '--cached', '--numstat'], { cwd: dir }).toString();
    expect(staged.trim().length).toBeGreaterThan(0);
    // Worktree still has both changes; only the first hunk's change was staged.
    const cachedShow = execFileSync('git', ['show', ':a.txt'], { cwd: dir }).toString();
    expect(cachedShow).toContain('line2 changed');
  });

  it('applies a partial-line selection within a single hunk via `git apply --cached`', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1 changed\nline2\nline3 changed\nline4\n');
    const rawDiff = execFileSync('git', ['diff', '--no-ext-diff', '--binary'], { cwd: dir }).toString();
    const [file] = parseUnifiedDiff(rawDiff);
    if (!file) throw new Error('expected file diff');
    const hunk = file.hunks[0];
    if (!hunk) throw new Error('expected hunk');

    // Select only the first add/remove pair (line1's change), not line3's.
    const removeIndex = hunk.lines.findIndex((l) => l.type === 'remove' && l.content === 'line1');
    const addIndex = hunk.lines.findIndex((l) => l.type === 'add' && l.content === 'line1 changed');
    const partial = renderPartialHunk(hunk, new Set([removeIndex, addIndex]));
    const patchText = buildFilePatch(file, [partial]);
    fs.writeFileSync(path.join(dir, 'partial.diff'), patchText);
    execFileSync('git', ['apply', '--cached', path.join(dir, 'partial.diff')], { cwd: dir });

    const cachedShow = execFileSync('git', ['show', ':a.txt'], { cwd: dir }).toString();
    expect(cachedShow).toBe('line1 changed\nline2\nline3\nline4\n');
  });
});
