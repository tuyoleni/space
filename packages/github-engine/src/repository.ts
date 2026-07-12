/**
 * GH-003: Repository creation (spec 14.5). The create/publish form takes
 * owner, name, visibility, an optional description, the source folder, a
 * remote name (default `origin`), and a push choice. The operation is
 * idempotent-aware (spec 39: never silently overwrite a remote repo) —
 * `planRepositoryPublish` always checks for an existing repository first
 * via structured `gh repo view --json`, and a caller that finds a
 * conflict must supply an explicit `connect`, `rename`, or `cancel`
 * resolution before anything mutates.
 */
import { runGh, runGhJsonOptional } from './json';
import type { GhExecutor } from './executor';

export type RepoVisibility = 'public' | 'private' | 'internal';

export interface RepoCreateInput {
  readonly owner: string;
  readonly name: string;
  readonly visibility: RepoVisibility;
  readonly description?: string;
  readonly sourceFolder: string;
  readonly remoteName?: string;
  readonly push: boolean;
}

function validateOwnerAndName(owner: string, name: string): void {
  if (owner.trim().length === 0 || owner.trim().startsWith('-')) {
    throw new Error(`Owner "${owner}" is not valid`);
  }
  if (name.trim().length === 0 || name.trim().startsWith('-')) {
    throw new Error(`Repository name "${name}" is not valid`);
  }
}

export function repoCreateArgs(input: RepoCreateInput): string[] {
  validateOwnerAndName(input.owner, input.name);
  const args = ['repo', 'create', `${input.owner}/${input.name}`];
  args.push(input.visibility === 'public' ? '--public' : input.visibility === 'private' ? '--private' : '--internal');
  if (input.description) {
    args.push('--description', input.description);
  }
  args.push('--source', input.sourceFolder, '--remote', input.remoteName ?? 'origin');
  if (input.push) {
    args.push('--push');
  }
  return args;
}

export interface GhRepoInfo {
  readonly owner: string;
  readonly name: string;
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly visibility: string;
}

interface RawRepoView {
  readonly owner: { readonly login: string };
  readonly name: string;
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly visibility: string;
}

const REPO_VIEW_JSON_FIELDS = 'owner,name,nameWithOwner,url,sshUrl,visibility';

/** Resolves to `null` (not an error) when the repository does not exist — that is the expected, common case this module has to distinguish from a real failure. */
export async function findExistingRepository(executor: GhExecutor, owner: string, name: string): Promise<GhRepoInfo | null> {
  validateOwnerAndName(owner, name);
  const raw = await runGhJsonOptional<RawRepoView>(executor, ['repo', 'view', `${owner}/${name}`, '--json', REPO_VIEW_JSON_FIELDS]);
  if (!raw) {
    return null;
  }
  return { owner: raw.owner.login, name: raw.name, nameWithOwner: raw.nameWithOwner, url: raw.url, sshUrl: raw.sshUrl, visibility: raw.visibility };
}

export type RepoPublishPlan = { readonly kind: 'create' } | { readonly kind: 'conflict'; readonly existing: GhRepoInfo };

/** Always checks for an existing repository first (spec 39: never silently overwrite). */
export async function planRepositoryPublish(executor: GhExecutor, owner: string, name: string): Promise<RepoPublishPlan> {
  const existing = await findExistingRepository(executor, owner, name);
  return existing ? { kind: 'conflict', existing } : { kind: 'create' };
}

export class RepositoryAlreadyExistsError extends Error {
  constructor(public readonly existing: GhRepoInfo) {
    super(`Repository "${existing.nameWithOwner}" already exists — choose connect, a different name, or cancel; it will not be overwritten.`);
    this.name = 'RepositoryAlreadyExistsError';
  }
}

export interface RepoCreateResult {
  readonly nameWithOwner: string;
  readonly url: string;
}

/**
 * Creates and publishes a new repository. Throws `RepositoryAlreadyExistsError`
 * (never overwrites) if `gh repo view` finds one at `owner/name` first —
 * callers that already resolved a conflict via `connect` or `rename` call
 * `repoCreateArgs`/`runGh` directly instead of this convenience wrapper,
 * or pass a `name` that has already been changed.
 */
export async function createAndPublishRepository(executor: GhExecutor, input: RepoCreateInput): Promise<RepoCreateResult> {
  const plan = await planRepositoryPublish(executor, input.owner, input.name);
  if (plan.kind === 'conflict') {
    throw new RepositoryAlreadyExistsError(plan.existing);
  }
  const result = await runGh(executor, repoCreateArgs(input));
  const url = result.stdout.trim().split('\n').pop() ?? '';
  return { nameWithOwner: `${input.owner}/${input.name}`, url };
}
