/**
 * Annotated tag creation and push (spec 14.10 GH-008's "create and push
 * tag" release step). Kept separate from `remote.ts` since a tag is a ref
 * operation, not a remote-tracking one, even though pushing it needs the
 * same `GitExecutor`.
 */
import { REF_FIELD_SEPARATOR, REF_RECORD_SEPARATOR, tagListArgs } from './commands';
import type { GitExecutor } from './clone';

export interface CreateAnnotatedTagOptions {
  readonly name: string;
  readonly message: string;
  readonly ref?: string;
}

/** One tag ref. `targetSha` is the peeled commit; `subject`/`taggedAt` come from the tag object (annotated) or the target commit (lightweight); `taggedAt` is unix epoch milliseconds, null when git reports no date. */
export interface TagEntry {
  readonly name: string;
  readonly targetSha: string;
  readonly subject: string | null;
  readonly taggedAt: number | null;
}

function validateTagName(name: string): void {
  if (name.trim().length === 0 || name.trim().startsWith('-')) {
    throw new Error(`Tag name "${name}" is not valid`);
  }
}

export function createAnnotatedTagArgs(options: CreateAnnotatedTagOptions): string[] {
  validateTagName(options.name);
  const args = ['tag', '-a', options.name, '-m', options.message];
  if (options.ref) {
    args.push('--', options.ref);
  }
  return args;
}

export async function createAnnotatedTag(cwd: string, options: CreateAnnotatedTagOptions, executor: GitExecutor): Promise<void> {
  const result = await executor(createAnnotatedTagArgs(options), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git tag failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}

export function pushTagArgs(remoteName: string, tagName: string): string[] {
  validateTagName(tagName);
  return ['push', '--', remoteName, tagName];
}

export async function pushTag(cwd: string, remoteName: string, tagName: string, executor: GitExecutor): Promise<void> {
  const result = await executor(pushTagArgs(remoteName, tagName), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git push tag failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}

/** Convenience: creates the annotated tag then pushes it in one call (spec 14.10's "create and push tag"). */
export async function createAndPushTag(cwd: string, remoteName: string, options: CreateAnnotatedTagOptions, executor: GitExecutor): Promise<void> {
  await createAnnotatedTag(cwd, options, executor);
  await pushTag(cwd, remoteName, options.name, executor);
}

/**
 * Parses `git for-each-ref refs/tags --format=<TAG_FORMAT>` output into one
 * entry per tag. Annotated tags carry a `*objectname` peel to their commit;
 * lightweight tags do not, so the target falls back to `objectname`. An
 * empty date column becomes `null` rather than epoch 0.
 */
export function parseTagRefs(output: string): TagEntry[] {
  const tags: TagEntry[] = [];
  for (const record of output.split(REF_RECORD_SEPARATOR)) {
    if (record.trim().length === 0) {
      continue;
    }
    const trimmed = record.replace(/^\n+/, '');
    const [name, objectName, peeledSha, subject, dateUnix] = trimmed.split(REF_FIELD_SEPARATOR);
    if (!name) {
      continue;
    }
    const peeled = (peeledSha ?? '').trim();
    const targetSha = peeled.length > 0 ? peeled : (objectName ?? '').trim();
    const subjectText = (subject ?? '').replace(/\n+$/, '');
    const seconds = Number((dateUnix ?? '').trim());
    tags.push({
      name,
      targetSha,
      subject: subjectText.length > 0 ? subjectText : null,
      taggedAt: Number.isFinite(seconds) && (dateUnix ?? '').trim().length > 0 ? seconds * 1000 : null,
    });
  }
  return tags;
}

/** Lists the repository's tags with their peeled target, subject, and tagged date. Returns `[]` when there are no tags. */
export async function listTags(cwd: string, executor: GitExecutor): Promise<TagEntry[]> {
  const result = await executor(tagListArgs(), { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git for-each-ref failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
  return parseTagRefs(result.stdout);
}
