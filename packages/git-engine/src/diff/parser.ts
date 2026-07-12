/**
 * Parsers for `git diff --raw -z` and `git diff --numstat -z` (spec
 * 11.3.4). Byte shapes below were confirmed against real git output before
 * writing this parser (renames carry an extra NUL-separated old-path
 * token; numstat renames carry an empty third field followed by two path
 * tokens) rather than assumed from documentation alone.
 */
import type { DiffNumstatEntry, DiffRawEntry, DiffStatusCode } from './types';

export function parseDiffRawOutput(output: string): DiffRawEntry[] {
  const tokens = output.split('\x00').filter((token) => token.length > 0);
  const entries: DiffRawEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (!token.startsWith(':')) {
      continue;
    }
    const [oldMode, newMode, oldSha, newSha, statusWithScore] = token.slice(1).split(' ');
    const statusCode = (statusWithScore as string)[0] as DiffStatusCode;
    const similarityScore =
      (statusWithScore as string).length > 1 ? Number((statusWithScore as string).slice(1)) : null;

    if (statusCode === 'R' || statusCode === 'C') {
      const oldPath = tokens[i + 1] ?? '';
      const path = tokens[i + 2] ?? '';
      i += 2;
      entries.push({ oldMode: oldMode as string, newMode: newMode as string, oldSha: oldSha as string, newSha: newSha as string, statusCode, similarityScore, path, oldPath });
    } else {
      const path = tokens[i + 1] ?? '';
      i += 1;
      entries.push({ oldMode: oldMode as string, newMode: newMode as string, oldSha: oldSha as string, newSha: newSha as string, statusCode, similarityScore, path, oldPath: null });
    }
  }
  return entries;
}

export function parseDiffNumstatOutput(output: string): DiffNumstatEntry[] {
  const tokens = output.split('\x00').filter((token) => token.length > 0);
  const entries: DiffNumstatEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const [addedRaw, removedRaw, pathField] = token.split('\t');
    const added = addedRaw === '-' ? null : Number(addedRaw);
    const removed = removedRaw === '-' ? null : Number(removedRaw);

    if ((pathField ?? '').length === 0) {
      const oldPath = tokens[i + 1] ?? '';
      const path = tokens[i + 2] ?? '';
      i += 2;
      entries.push({ added, removed, path, oldPath });
    } else {
      entries.push({ added, removed, path: pathField as string, oldPath: null });
    }
  }
  return entries;
}
