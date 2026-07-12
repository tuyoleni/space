import { describe, expect, it } from 'vitest';
import { REF_FIELD_SEPARATOR as F, REF_RECORD_SEPARATOR as R } from '../commands';
import { parseForEachRefOutput } from './parser';

function record(refname: string, sha: string, peeled: string, type: string, head: string, upstream: string, track: string, subject: string): string {
  return [refname, sha, peeled, type, head, upstream, track, subject].join(F) + R;
}

describe('parseForEachRefOutput', () => {
  it('parses a local branch that is the current HEAD', () => {
    const output = record('refs/heads/main', 'abc123', '', 'commit', '*', 'refs/remotes/origin/main', '', 'initial commit');
    const [ref] = parseForEachRefOutput(output);
    expect(ref).toMatchObject({
      kind: 'local-branch',
      shortName: 'main',
      sha: 'abc123',
      isHead: true,
      upstream: 'refs/remotes/origin/main',
    });
  });

  it('parses ahead/behind tracking', () => {
    const output = record('refs/heads/feature', 'def456', '', 'commit', '', 'refs/remotes/origin/feature', '[ahead 2, behind 1]', 'wip');
    const [ref] = parseForEachRefOutput(output);
    expect(ref?.ahead).toBe(2);
    expect(ref?.behind).toBe(1);
    expect(ref?.upstreamGone).toBe(false);
  });

  it('parses a gone upstream', () => {
    const output = record('refs/heads/stale', 'aaa', '', 'commit', '', 'refs/remotes/origin/stale', '[gone]', 'stale');
    const [ref] = parseForEachRefOutput(output);
    expect(ref?.upstreamGone).toBe(true);
    expect(ref?.ahead).toBeNull();
  });

  it('parses a remote-tracking branch', () => {
    const output = record('refs/remotes/origin/main', 'abc123', '', 'commit', '', '', '', 'initial commit');
    const [ref] = parseForEachRefOutput(output);
    expect(ref?.kind).toBe('remote-branch');
    expect(ref?.shortName).toBe('origin/main');
  });

  it('parses an annotated tag with a peeled commit SHA', () => {
    const output = record('refs/tags/v1.0.0', 'tagobjectsha', 'peeledcommitsha', 'tag', '', '', '', 'Release v1.0.0');
    const [ref] = parseForEachRefOutput(output);
    expect(ref).toMatchObject({ kind: 'tag', shortName: 'v1.0.0', sha: 'tagobjectsha', peeledSha: 'peeledcommitsha' });
  });

  it('parses a lightweight tag without a peeled SHA', () => {
    const output = record('refs/tags/v0.1.0', 'commitsha', '', 'commit', '', '', '', 'first commit');
    const [ref] = parseForEachRefOutput(output);
    expect(ref?.peeledSha).toBeNull();
  });

  it('skips refs outside heads/remotes/tags (e.g. stash, replace refs)', () => {
    const output = record('refs/stash', 'stashsha', '', 'commit', '', '', '', 'WIP') + record('refs/heads/main', 'abc', '', 'commit', '*', '', '', 'msg');
    const refs = parseForEachRefOutput(output);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.refname).toBe('refs/heads/main');
  });

  it('parses multiple records separated by NUL', () => {
    const output =
      record('refs/heads/main', 'a', '', 'commit', '*', '', '', 'a') +
      record('refs/heads/dev', 'b', '', 'commit', '', '', '', 'b') +
      record('refs/tags/v1', 'c', '', 'commit', '', '', '', 'c');
    expect(parseForEachRefOutput(output)).toHaveLength(3);
  });

  it('handles subjects containing unicode and the field separator-adjacent text safely', () => {
    const output = record('refs/heads/main', 'a', '', 'commit', '*', '', '', 'fix: 修复了一个 bug 🎉');
    const [ref] = parseForEachRefOutput(output);
    expect(ref?.subject).toBe('fix: 修复了一个 bug 🎉');
  });
});
