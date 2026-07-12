/**
 * Annotated tag creation and push (spec 14.10 GH-008's "create and push
 * tag" release step). Kept separate from `remote.ts` since a tag is a ref
 * operation, not a remote-tracking one, even though pushing it needs the
 * same `GitExecutor`.
 */
import type { GitExecutor } from './clone';

export interface CreateAnnotatedTagOptions {
  readonly name: string;
  readonly message: string;
  readonly ref?: string;
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
