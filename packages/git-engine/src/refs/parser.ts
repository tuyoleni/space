/**
 * Parser for `git for-each-ref --format=<NUL-safe structured format>`
 * (spec 11.3.2). Pure function over a string, covered by fixtures for
 * local/remote branches, annotated and lightweight tags, upstream
 * tracking (ahead/behind/gone), and the current HEAD marker.
 */
import { REF_FIELD_SEPARATOR, REF_RECORD_SEPARATOR } from '../commands';
import type { RefEntry, RefKind } from './types';

function classify(refname: string): { kind: RefKind; shortName: string } | null {
  if (refname.startsWith('refs/heads/')) {
    return { kind: 'local-branch', shortName: refname.slice('refs/heads/'.length) };
  }
  if (refname.startsWith('refs/remotes/')) {
    return { kind: 'remote-branch', shortName: refname.slice('refs/remotes/'.length) };
  }
  if (refname.startsWith('refs/tags/')) {
    return { kind: 'tag', shortName: refname.slice('refs/tags/'.length) };
  }
  return null;
}

function parseTrack(track: string): { ahead: number | null; behind: number | null; gone: boolean } {
  if (track.length === 0) {
    return { ahead: null, behind: null, gone: false };
  }
  if (track.includes('gone')) {
    return { ahead: null, behind: null, gone: true };
  }
  const aheadMatch = /ahead (\d+)/.exec(track);
  const behindMatch = /behind (\d+)/.exec(track);
  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : null,
    behind: behindMatch ? Number(behindMatch[1]) : null,
    gone: false,
  };
}

export function parseForEachRefOutput(output: string): RefEntry[] {
  const refs: RefEntry[] = [];
  for (const record of output.split(REF_RECORD_SEPARATOR)) {
    if (record.trim().length === 0) {
      continue;
    }
    const trimmed = record.replace(/^\n+/, '');
    const [refname, sha, peeledSha, objectType, headMarker, upstream, track, ...subjectParts] =
      trimmed.split(REF_FIELD_SEPARATOR);
    if (!refname) {
      continue;
    }
    const classified = classify(refname);
    if (!classified) {
      // refs/stash, replace refs, and other non-branch/tag refs are not
      // shown in the history/branch UI (spec 12.2 lists branches/tags/HEAD).
      continue;
    }
    const trackInfo = parseTrack((track ?? '').trim());
    refs.push({
      refname,
      kind: classified.kind,
      shortName: classified.shortName,
      sha: (sha ?? '').trim(),
      peeledSha: (peeledSha ?? '').trim().length > 0 ? (peeledSha as string).trim() : null,
      objectType: (objectType ?? '').trim(),
      isHead: (headMarker ?? '').trim() === '*',
      upstream: (upstream ?? '').trim().length > 0 ? (upstream as string).trim() : null,
      ahead: trackInfo.ahead,
      behind: trackInfo.behind,
      upstreamGone: trackInfo.gone,
      subject: subjectParts.join(REF_FIELD_SEPARATOR).replace(/\n+$/, ''),
    });
  }
  return refs;
}
