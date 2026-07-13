import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, type FileDiff } from '@space/git-engine';
import { buildSelectionsFromFileDiffs } from './diff-selection';
import {
  buildAuditEntry,
  buildModelDisclosure,
  completeAuditEntry,
  isEligibleForModel,
  ModelRequestCancellation,
  ModelRequestCancelledError,
} from './model-privacy';

const SECRET_PATCH = [
  'diff --git a/config.ts b/config.ts',
  'index e69de29..b1e6722 100644',
  '--- a/config.ts',
  '+++ b/config.ts',
  '@@ -1 +1,2 @@',
  ' const x = 1;',
  '+const apiKey = "abcd1234efgh5678";',
  '',
].join('\n');

const ENV_PATCH = [
  'diff --git a/.env b/.env',
  'index e69de29..b1e6722 100644',
  '--- a/.env',
  '+++ b/.env',
  '@@ -0,0 +1 @@',
  '+SECRET=hunter2',
  '',
].join('\n');

const BINARY_PATCH = [
  'diff --git a/logo.png b/logo.png',
  'index aaa..bbb 100644',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

function lookupFrom(files: readonly FileDiff[]) {
  return (filePath: string) => files.find((f) => f.path === filePath) ?? null;
}

describe('isEligibleForModel', () => {
  it('excludes binary files', () => {
    expect(isEligibleForModel('logo.png', true)).toBe(false);
  });

  it('excludes known-sensitive paths regardless of content', () => {
    expect(isEligibleForModel('.env', false)).toBe(false);
    expect(isEligibleForModel('.ssh/id_rsa', false)).toBe(false);
  });

  it('permits ordinary source files', () => {
    expect(isEligibleForModel('src/index.ts', false)).toBe(true);
  });
});

describe('buildModelDisclosure', () => {
  it('redacts a secret-shaped value inside an otherwise-eligible file', () => {
    const files = parseUnifiedDiff(SECRET_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    const disclosure = buildModelDisclosure(selections, lookupFrom(files));
    expect(disclosure.fragments).toHaveLength(1);
    expect(disclosure.fragments[0]?.redactedText).not.toContain('abcd1234efgh5678');
    expect(disclosure.fragments[0]?.redactedText).toContain('[REDACTED]');
    expect(disclosure.excluded).toEqual([]);
  });

  it('excludes a sensitive-path file entirely and reports why, never disclosing its content', () => {
    const files = parseUnifiedDiff(ENV_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    const disclosure = buildModelDisclosure(selections, lookupFrom(files));
    expect(disclosure.fragments).toEqual([]);
    expect(disclosure.excluded).toEqual([{ filePath: '.env', reason: 'sensitive-path' }]);
  });

  it('excludes binary files with no hunks to select in the first place', () => {
    const files = parseUnifiedDiff(BINARY_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    expect(selections).toEqual([]);
    const disclosure = buildModelDisclosure(selections, lookupFrom(files));
    expect(disclosure.fragments).toEqual([]);
  });

  it('sends only the selected hunk, not the whole file (minimum evidence)', () => {
    const twoHunkPatch = [
      'diff --git a/a.txt b/a.txt',
      'index e69de29..b1e6722 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '@@ -10 +10 @@',
      '-p',
      '+q',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(twoHunkPatch);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged').slice(0, 1);
    const disclosure = buildModelDisclosure(selections, lookupFrom(files));
    expect(disclosure.fragments).toHaveLength(1);
    expect(disclosure.fragments[0]?.redactedText).not.toContain('-p');
    expect(disclosure.fragments[0]?.redactedText).not.toContain('+q');
  });
});

describe('audit trail', () => {
  it('records counts and paths only, never the redacted/raw text itself', () => {
    const files = parseUnifiedDiff(SECRET_PATCH);
    const selections = buildSelectionsFromFileDiffs(files, 'unstaged');
    const disclosure = buildModelDisclosure(selections, lookupFrom(files));
    const entry = buildAuditEntry('req-1', disclosure, '2026-07-13T00:00:00.000Z');
    expect(entry.outcome).toBe('pending');
    expect(entry.fragmentCount).toBe(1);
    expect(entry.filePaths).toEqual(['config.ts']);
    expect(JSON.stringify(entry)).not.toContain('abcd1234efgh5678');

    const completed = completeAuditEntry(entry, 'completed', '2026-07-13T00:00:01.000Z');
    expect(completed.outcome).toBe('completed');
    expect(completed.endedAt).toBe('2026-07-13T00:00:01.000Z');
  });
});

describe('ModelRequestCancellation', () => {
  it('throws only after cancel() is called', () => {
    const token = new ModelRequestCancellation();
    expect(() => token.throwIfCancelled()).not.toThrow();
    token.cancel();
    expect(token.isCancelled).toBe(true);
    expect(() => token.throwIfCancelled()).toThrow(ModelRequestCancelledError);
  });
});
