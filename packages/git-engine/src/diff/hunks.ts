/**
 * Unified diff hunk parser (spec sections 11.3.4, 13.1 CHG-001: intent
 * groups must preserve traceability to "exact file paths, hunks, line
 * ranges"). `parseDiffRawOutput`/`parseDiffNumstatOutput` in `parser.ts`
 * give per-file status and line counts from `--raw -z`/`--numstat -z`;
 * neither carries hunk bodies. This module parses the full patch text
 * produced by `diffPatchArgs()` (`git diff --no-ext-diff --binary`, spec
 * 11.3.4) — the same machine-readable, unmodified `git diff` output, one
 * level more detailed — into structured hunks and lines. It never invents
 * diff content: every `FileDiff` here traces back to a real patch string
 * that came from `GitExecutor` running the real `git diff` command.
 *
 * `rawHeader` preserves the exact bytes git produced between `diff --git`
 * and the first `@@` hunk header (mode/index/rename/binary lines) verbatim
 * so a subset of a file's hunks can be re-serialized into a
 * `git apply`-able patch (spec 13.4 commit composition) without
 * synthesizing a fake index line.
 */

export type DiffHunkLineType = 'context' | 'add' | 'remove';

export interface DiffHunkLine {
  readonly type: DiffHunkLineType;
  /** Line content without the leading ' '/'+'/'-' marker. */
  readonly content: string;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
}

export interface DiffHunk {
  /** The exact `@@ -a,b +c,d @@ ...` header line as git produced it. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffHunkLine[];
}

export interface FileDiff {
  readonly path: string;
  /** Non-null only when the file was renamed/copied. */
  readonly oldPath: string | null;
  readonly isBinary: boolean;
  readonly isNewFile: boolean;
  readonly isDeletedFile: boolean;
  /** Verbatim header block (mode/index/rename lines) preceding the first hunk. */
  readonly rawHeader: string;
  readonly hunks: readonly DiffHunk[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/;

function stripAbPrefix(pathLine: string): string | null {
  const value = pathLine.slice(4);
  if (value === '/dev/null') {
    return null;
  }
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
}

function splitFileSections(patchText: string): string[][] {
  if (patchText.length === 0) {
    return [];
  }
  const lines = patchText.split('\n');
  // A trailing '\n' (the normal case for git's own output) produces one
  // trailing '' element that is not a real diff line — without this, it
  // would be misread as a blank context line and appended to the last hunk.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        sections.push(current);
      }
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) {
    sections.push(current);
  }
  return sections;
}

function parseHunkHeader(line: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  const match = HUNK_HEADER_RE.exec(line);
  if (!match) {
    return null;
  }
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] !== undefined ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newLines: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

function parseFileSection(lines: string[]): FileDiff {
  let i = 0;
  const headerLines: string[] = [];
  while (i < lines.length && !(lines[i] as string).startsWith('@@ ')) {
    headerLines.push(lines[i] as string);
    i += 1;
  }
  const rawHeader = headerLines.join('\n');

  let isNewFile = false;
  let isDeletedFile = false;
  let isBinary = false;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let oldPathFromMarker: string | null = null;
  let newPathFromMarker: string | null = null;

  for (const line of headerLines) {
    if (line.startsWith('new file mode')) {
      isNewFile = true;
    } else if (line.startsWith('deleted file mode')) {
      isDeletedFile = true;
    } else if (line.startsWith('rename from ')) {
      renameFrom = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      renameTo = line.slice('rename to '.length);
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      isBinary = true;
    } else if (line.startsWith('--- ')) {
      oldPathFromMarker = stripAbPrefix(line);
    } else if (line.startsWith('+++ ')) {
      newPathFromMarker = stripAbPrefix(line);
    }
  }

  const diffGitMatch = DIFF_GIT_RE.exec(headerLines[0] ?? '');
  const path = newPathFromMarker ?? renameTo ?? diffGitMatch?.[2] ?? '';
  const oldPath = isNewFile
    ? null
    : (renameFrom ?? (oldPathFromMarker && oldPathFromMarker !== path ? oldPathFromMarker : null));

  const hunks: DiffHunk[] = [];
  while (i < lines.length) {
    const line = lines[i] as string;
    const header = parseHunkHeader(line);
    if (!header) {
      i += 1;
      continue;
    }
    i += 1;
    const hunkLines: DiffHunkLine[] = [];
    let oldLineNumber = header.oldStart;
    let newLineNumber = header.newStart;
    while (i < lines.length) {
      const hLine = lines[i] as string;
      if (hLine.startsWith('@@ ') || hLine.startsWith('diff --git ')) {
        break;
      }
      if (hLine.startsWith('\\ No newline')) {
        i += 1;
        continue;
      }
      const marker = hLine.length > 0 ? hLine[0] : ' ';
      const content = hLine.slice(1);
      if (marker === ' ') {
        hunkLines.push({ type: 'context', content, oldLineNumber, newLineNumber });
        oldLineNumber += 1;
        newLineNumber += 1;
      } else if (marker === '-') {
        hunkLines.push({ type: 'remove', content, oldLineNumber, newLineNumber: null });
        oldLineNumber += 1;
      } else if (marker === '+') {
        hunkLines.push({ type: 'add', content, oldLineNumber: null, newLineNumber });
        newLineNumber += 1;
      } else {
        break;
      }
      i += 1;
    }
    hunks.push({ header: line, oldStart: header.oldStart, oldLines: header.oldLines, newStart: header.newStart, newLines: header.newLines, lines: hunkLines });
  }

  return { path, oldPath, isBinary, isNewFile, isDeletedFile, rawHeader, hunks };
}

/** Parses the full multi-file patch text from `diffPatchArgs()` output into structured, hunk-level `FileDiff`s. */
export function parseUnifiedDiff(patchText: string): FileDiff[] {
  return splitFileSections(patchText).map(parseFileSection);
}

function renderLine(line: DiffHunkLine): string {
  const marker = line.type === 'context' ? ' ' : line.type === 'add' ? '+' : '-';
  return `${marker}${line.content}`;
}

function renderHunkHeader(oldStart: number, oldLines: number, newStart: number, newLines: number): string {
  const oldPart = oldLines === 1 ? `${oldStart}` : `${oldStart},${oldLines}`;
  const newPart = newLines === 1 ? `${newStart}` : `${newStart},${newLines}`;
  return `@@ -${oldPart} +${newPart} @@`;
}

/**
 * Reconstructs a single hunk's exact patch text (header verbatim, one line
 * per `DiffHunkLine`) — used to build a `git apply`-able patch from a
 * whole-hunk selection (spec 13.4).
 */
export function renderHunk(hunk: DiffHunk): string {
  return [hunk.header, ...hunk.lines.map(renderLine)].join('\n');
}

/**
 * Builds a `git apply`-able patch for one file from a subset of its
 * hunks, reusing the file's exact verbatim header (mode/index/rename
 * lines) rather than synthesizing one. `git apply` matches by context, not
 * by the index line's blob SHAs, so omitting hunks (or lines, via
 * `renderPartialHunk`) is safe (GIT-004's `staging.ts` documents the same
 * mechanism for hunk/line-level staging).
 */
export function buildFilePatch(file: FileDiff, hunks: readonly DiffHunk[]): string {
  const lines = [file.rawHeader, ...hunks.map(renderHunk)];
  return `${lines.join('\n')}\n`;
}

/**
 * Splits a hunk down to a subset of its add/remove lines (spec 13.4:
 * "compose a commit from selected intent groups, files, hunks, or lines").
 * Mirrors the standard interactive-staging algorithm: an unselected
 * addition is dropped entirely (it never happened, as far as this patch is
 * concerned); an unselected removal is downgraded to context (the line
 * stays, since this patch does not remove it). Context lines are always
 * kept. Hunk header counts are recomputed to match.
 */
export function renderPartialHunk(hunk: DiffHunk, selectedLineIndexes: ReadonlySet<number>): DiffHunk {
  const outLines: DiffHunkLine[] = [];
  let oldCount = 0;
  let newCount = 0;
  hunk.lines.forEach((line, index) => {
    if (line.type === 'context') {
      outLines.push(line);
      oldCount += 1;
      newCount += 1;
      return;
    }
    if (line.type === 'remove') {
      if (selectedLineIndexes.has(index)) {
        outLines.push(line);
        oldCount += 1;
      } else {
        outLines.push({ type: 'context', content: line.content, oldLineNumber: line.oldLineNumber, newLineNumber: null });
        oldCount += 1;
        newCount += 1;
      }
      return;
    }
    // add
    if (selectedLineIndexes.has(index)) {
      outLines.push(line);
      newCount += 1;
    }
  });
  return {
    header: renderHunkHeader(hunk.oldStart, oldCount, hunk.newStart, newCount),
    oldStart: hunk.oldStart,
    oldLines: oldCount,
    newStart: hunk.newStart,
    newLines: newCount,
    lines: outLines,
  };
}
