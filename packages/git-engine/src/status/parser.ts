/**
 * Parser for `git status --porcelain=v2 -z --branch` (spec 11.3.1, 11.4).
 * Pure function over a string; covered by fixtures for the initial-repo
 * case, ordinary changes, renames/copies, unmerged/conflict entries,
 * untracked/ignored files, and submodules. All records (including header
 * lines) are NUL-terminated under `-z` — confirmed against real git output,
 * not assumed — so the whole stream is split on `\x00` and consumed
 * sequentially rather than line-by-line.
 */
import type {
  BranchInfo,
  FileStatusCode,
  RepositoryStatus,
  StatusEntry,
  SubmoduleState,
} from './types';

function parseSubmoduleField(field: string): SubmoduleState {
  if (field === 'N...') {
    return { isSubmodule: false, commitChanged: false, hasModifiedContent: false, hasUntrackedContent: false };
  }
  // "S<c><m><u>" — each flag is the letter when set, '.' when not.
  return {
    isSubmodule: true,
    commitChanged: field[1] === 'C',
    hasModifiedContent: field[2] === 'M',
    hasUntrackedContent: field[3] === 'U',
  };
}

function parseBranchHeaderLine(line: string, branch: Partial<BranchInfo>): void {
  const body = line.slice('# '.length);
  if (body.startsWith('branch.oid ')) {
    const value = body.slice('branch.oid '.length).trim();
    branch.isInitial = value === '(initial)';
    branch.headCommit = branch.isInitial ? null : value;
  } else if (body.startsWith('branch.head ')) {
    const value = body.slice('branch.head '.length).trim();
    branch.detached = value === '(detached)';
    branch.branchName = branch.detached ? null : value;
  } else if (body.startsWith('branch.upstream ')) {
    branch.upstream = body.slice('branch.upstream '.length).trim();
  } else if (body.startsWith('branch.ab ')) {
    const match = /\+(\d+)\s+-(\d+)/.exec(body.slice('branch.ab '.length));
    if (match) {
      branch.ahead = Number(match[1]);
      branch.behind = Number(match[2]);
    }
  }
}

function toStatusCode(char: string): FileStatusCode {
  return (char as FileStatusCode) ?? '.';
}

export function parseStatusOutput(output: string): RepositoryStatus {
  const tokens = output.split('\x00').filter((token) => token.length > 0);
  const branch: Partial<BranchInfo> = {
    headCommit: null,
    isInitial: false,
    branchName: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
  };
  const entries: StatusEntry[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (token.startsWith('# ')) {
      parseBranchHeaderLine(token, branch);
      continue;
    }

    const kind = token[0];
    const parts = token.split(' ');

    if (kind === '1') {
      const [, xy, sub, mH, mI, mW] = parts;
      const path = parts.slice(8).join(' ');
      entries.push({
        kind: 'ordinary',
        path,
        indexStatus: toStatusCode((xy as string)[0] as string),
        worktreeStatus: toStatusCode((xy as string)[1] as string),
        headMode: mH as string,
        indexMode: mI as string,
        worktreeMode: mW as string,
        submodule: parseSubmoduleField(sub as string),
      });
    } else if (kind === '2') {
      const [, xy, sub, mH, mI, mW] = parts;
      const scoreField = parts[8] as string;
      const path = parts.slice(9).join(' ');
      const originalPath = tokens[i + 1] ?? '';
      i += 1;
      entries.push({
        kind: 'renamed-or-copied',
        path,
        originalPath,
        indexStatus: toStatusCode((xy as string)[0] as string),
        worktreeStatus: toStatusCode((xy as string)[1] as string),
        renameOrCopy: scoreField[0] === 'C' ? 'C' : 'R',
        similarityScore: Number(scoreField.slice(1)) || 0,
        submodule: parseSubmoduleField(sub as string),
      });
      void mH;
      void mI;
      void mW;
    } else if (kind === 'u') {
      const [, xy, sub] = parts;
      const path = parts.slice(10).join(' ');
      entries.push({
        kind: 'unmerged',
        path,
        conflictCode: xy as string,
        submodule: parseSubmoduleField(sub as string),
      });
    } else if (kind === '?') {
      entries.push({ kind: 'untracked', path: parts.slice(1).join(' ') });
    } else if (kind === '!') {
      entries.push({ kind: 'ignored', path: parts.slice(1).join(' ') });
    }
  }

  return { branch: branch as BranchInfo, entries };
}
