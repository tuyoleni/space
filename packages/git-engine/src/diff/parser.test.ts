import { describe, expect, it } from 'vitest';
import { parseDiffNumstatOutput, parseDiffRawOutput } from './parser';

describe('parseDiffRawOutput', () => {
  it('parses an added file', () => {
    const output = ':000000 100644 0000000 3e75765 A\0c.txt\0';
    expect(parseDiffRawOutput(output)).toEqual([
      { oldMode: '000000', newMode: '100644', oldSha: '0000000', newSha: '3e75765', statusCode: 'A', similarityScore: null, path: 'c.txt', oldPath: null },
    ]);
  });

  it('parses a modified file', () => {
    const output = ':100644 100644 aaa bbb M\0a.txt\0';
    const [entry] = parseDiffRawOutput(output);
    expect(entry).toMatchObject({ statusCode: 'M', path: 'a.txt', oldPath: null });
  });

  it('parses a deleted file', () => {
    const output = ':100644 000000 aaa 0000000 D\0removed.txt\0';
    const [entry] = parseDiffRawOutput(output);
    expect(entry).toMatchObject({ statusCode: 'D', path: 'removed.txt' });
  });

  it('parses a rename with similarity score and two path tokens (real byte shape)', () => {
    const output = ':100644 100644 83db48f 83db48f R100\0a.txt\0b.txt\0';
    const [entry] = parseDiffRawOutput(output);
    expect(entry).toEqual({
      oldMode: '100644',
      newMode: '100644',
      oldSha: '83db48f',
      newSha: '83db48f',
      statusCode: 'R',
      similarityScore: 100,
      path: 'b.txt',
      oldPath: 'a.txt',
    });
  });

  it('parses multiple mixed entries in one stream', () => {
    const output = ':100644 100644 83db48f 83db48f R100\0a.txt\0b.txt\0:000000 100644 0000000 3e75765 A\0c.txt\0';
    const entries = parseDiffRawOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.statusCode).toBe('R');
    expect(entries[1]?.statusCode).toBe('A');
  });

  it('parses a type-changed entry', () => {
    const output = ':100644 120000 aaa bbb T\0symlinked\0';
    const [entry] = parseDiffRawOutput(output);
    expect(entry?.statusCode).toBe('T');
  });
});

describe('parseDiffNumstatOutput', () => {
  it('parses an added file with line counts', () => {
    const output = '1\t0\tc.txt\0';
    expect(parseDiffNumstatOutput(output)).toEqual([{ added: 1, removed: 0, path: 'c.txt', oldPath: null }]);
  });

  it('parses a binary file as null added/removed', () => {
    const output = '-\t-\tbinary.png\0';
    expect(parseDiffNumstatOutput(output)).toEqual([{ added: null, removed: null, path: 'binary.png', oldPath: null }]);
  });

  it('parses a rename with the empty-third-field + two-path-token shape (real byte shape)', () => {
    const output = '0\t0\t\x00a.txt\x00b.txt\x00';
    expect(parseDiffNumstatOutput(output)).toEqual([{ added: 0, removed: 0, path: 'b.txt', oldPath: 'a.txt' }]);
  });

  it('parses multiple entries including a mix of rename and normal', () => {
    const output = '0\t0\t\x00a.txt\x00b.txt\x001\t0\tc.txt\x00';
    const entries = parseDiffNumstatOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ added: 0, removed: 0, path: 'b.txt', oldPath: 'a.txt' });
    expect(entries[1]).toEqual({ added: 1, removed: 0, path: 'c.txt', oldPath: null });
  });
});
