/**
 * GH-008: Releases (spec 14.10). Compare changes since a selected tag,
 * suggest a draft version (subject to explicit confirmation — this
 * module never picks the final version itself), generate editable
 * release notes, create+push the tag (delegated to `@space/git-engine`'s
 * `tag.ts`), trigger the release workflow (delegated to `actions.ts`),
 * upload artifacts, and publish or save as draft/prerelease.
 *
 * Publishing is a high-impact remote action and requires confirmation
 * (spec 14.10, 39) — `publishRelease` is gated behind
 * `assertHighImpactGithubActionConfirmed` exactly like `mergePullRequest`,
 * and creating a *draft* never needs that gate since nothing is visible
 * to anyone yet.
 */
import { assertHighImpactGithubActionConfirmed } from '@space/domain';
import { runGh, runGhJson } from './json';
import type { GhExecutor } from './executor';

export interface CompareSummary {
  readonly aheadBy: number;
  readonly totalCommits: number;
  readonly commitSubjects: readonly string[];
  readonly changedFiles: readonly string[];
}

interface RawCompare {
  readonly ahead_by: number;
  readonly total_commits: number;
  readonly commits: readonly { readonly commit: { readonly message: string } }[];
  readonly files: readonly { readonly filename: string }[];
}

export function compareSinceTagArgs(nameWithOwner: string, sinceTag: string, head: string): string[] {
  return ['api', `repos/${nameWithOwner}/compare/${sinceTag}...${head}`];
}

export async function compareSinceTag(executor: GhExecutor, nameWithOwner: string, sinceTag: string, head: string): Promise<CompareSummary> {
  const raw = await runGhJson<RawCompare>(executor, compareSinceTagArgs(nameWithOwner, sinceTag, head));
  return {
    aheadBy: raw.ahead_by,
    totalCommits: raw.total_commits,
    commitSubjects: raw.commits.map((c) => c.commit.message.split('\n')[0] ?? ''),
    changedFiles: raw.files.map((f) => f.filename),
  };
}

export type SemverBump = 'major' | 'minor' | 'patch';

const BREAKING_PATTERN = /^\w+(\([^)]*\))?!:|BREAKING CHANGE/;
const FEAT_PATTERN = /^feat(\([^)]*\))?:/;
const FIX_PATTERN = /^fix(\([^)]*\))?:/;

/** Conventional-commit-shaped heuristic over real commit subjects — a suggestion only; spec 14.10 requires the user to confirm before this becomes the actual tag. */
export function suggestSemverBump(commitSubjects: readonly string[]): SemverBump {
  if (commitSubjects.some((subject) => BREAKING_PATTERN.test(subject))) {
    return 'major';
  }
  if (commitSubjects.some((subject) => FEAT_PATTERN.test(subject))) {
    return 'minor';
  }
  if (commitSubjects.some((subject) => FIX_PATTERN.test(subject))) {
    return 'patch';
  }
  return 'patch';
}

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parses a `vX.Y.Z` or `X.Y.Z` tag; returns null for anything else rather than guessing. */
export function parseSemverTag(tag: string): ParsedSemver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function applySemverBump(current: ParsedSemver, bump: SemverBump): ParsedSemver {
  switch (bump) {
    case 'major':
      return { major: current.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case 'patch':
      return { major: current.major, minor: current.minor, patch: current.patch + 1 };
    default: {
      const exhaustive: never = bump;
      throw new Error(`Unknown bump: ${String(exhaustive)}`);
    }
  }
}

export function formatSemverTag(version: ParsedSemver, previousTagPrefix: string): string {
  return `${previousTagPrefix}${version.major}.${version.minor}.${version.patch}`;
}

/** Draft version suggestion (spec 14.10) — a suggestion string, never applied without the user confirming it becomes the actual tag name passed to `createAndPublishRelease`. */
export function suggestNextVersionTag(previousTag: string, commitSubjects: readonly string[]): string | null {
  const parsed = parseSemverTag(previousTag);
  if (!parsed) return null;
  const prefix = previousTag.trim().startsWith('v') ? 'v' : '';
  return formatSemverTag(applySemverBump(parsed, suggestSemverBump(commitSubjects)), prefix);
}

export function generateNotesArgs(nameWithOwner: string, tagName: string, targetCommitish?: string): string[] {
  const args = ['api', `repos/${nameWithOwner}/releases/generate-notes`, '-f', `tag_name=${tagName}`];
  if (targetCommitish) {
    args.push('-f', `target_commitish=${targetCommitish}`);
  }
  args.push('--jq', '.body');
  return args;
}

/** Generated notes are always editable before publish (spec 14.10) — this returns the raw text, never auto-submits it. */
export async function generateReleaseNotes(executor: GhExecutor, nameWithOwner: string, tagName: string, targetCommitish?: string): Promise<string> {
  const result = await runGh(executor, generateNotesArgs(nameWithOwner, tagName, targetCommitish));
  return result.stdout.trim();
}

export interface ReleaseCreateInput {
  readonly tagName: string;
  readonly title: string;
  readonly notes: string;
  readonly target?: string;
  readonly prerelease?: boolean;
}

export function releaseCreateDraftArgs(input: ReleaseCreateInput): string[] {
  const args = ['release', 'create', input.tagName, '--title', input.title, '--notes', input.notes, '--draft'];
  if (input.target) args.push('--target', input.target);
  if (input.prerelease) args.push('--prerelease');
  return args;
}

/** Always creates as a draft first — nothing is visible to anyone until a separate, confirmed `publishRelease` call (spec 14.10, 39: publishing requires confirmation). */
export async function createDraftRelease(executor: GhExecutor, input: ReleaseCreateInput): Promise<{ readonly url: string }> {
  const result = await runGh(executor, releaseCreateDraftArgs(input));
  return { url: result.stdout.trim().split('\n').pop() ?? '' };
}

export function publishReleaseArgs(tagName: string): string[] {
  return ['release', 'edit', tagName, '--draft=false'];
}

export interface PublishReleaseInput {
  readonly tagName: string;
  readonly confirmed: boolean;
}

/** Flips an existing draft to published. Never runs without a confirmed flag (spec 14.10, 39). */
export async function publishRelease(executor: GhExecutor, input: PublishReleaseInput): Promise<void> {
  assertHighImpactGithubActionConfirmed({ action: 'publish-release', confirmed: input.confirmed });
  await runGh(executor, publishReleaseArgs(input.tagName));
}

export function releaseUploadArgs(tagName: string, filePaths: readonly string[], clobber: boolean): string[] {
  const args = ['release', 'upload', tagName, ...filePaths];
  if (clobber) args.push('--clobber');
  return args;
}

export async function uploadReleaseArtifacts(executor: GhExecutor, tagName: string, filePaths: readonly string[], clobber = false): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }
  await runGh(executor, releaseUploadArgs(tagName, filePaths, clobber));
}
