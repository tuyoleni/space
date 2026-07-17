/**
 * GH-004: Pull requests (spec 14.6). List/filter, detail, create from the
 * current branch, reviewers/assignees/labels, files/commits/timeline,
 * mergeability, checkout, and merge — every read uses `gh`'s structured
 * `--json` output (spec 14.5/39: never parse colored human text when a
 * stable machine-readable form exists). Merge is gated behind
 * `assertHighImpactGithubActionConfirmed` (spec 14.6: "merge only with
 * explicit confirmation and policy checks") so no call site can merge
 * without an explicit, already-checked confirmation flag.
 */
import { assertHighImpactGithubActionConfirmed } from '@space/domain';
import { isNoRepoContextError, runGh, runGhJson } from './json';
import type { GhExecutor } from './executor';

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly labels: readonly string[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawPrListItem {
  readonly number: number;
  readonly title: string;
  readonly author: { readonly login: string };
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly labels: readonly { readonly name: string }[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const LIST_JSON_FIELDS = 'number,title,author,headRefName,baseRefName,state,isDraft,labels,url,createdAt,updatedAt';

export interface PullRequestListFilter {
  readonly state?: 'open' | 'closed' | 'merged' | 'all';
  readonly baseBranch?: string;
  readonly headBranch?: string;
  readonly author?: string;
  readonly label?: string;
  readonly limit?: number;
}

export function prListArgs(filter: PullRequestListFilter = {}): string[] {
  const args = ['pr', 'list', '--json', LIST_JSON_FIELDS];
  args.push('--state', filter.state ?? 'open');
  if (filter.baseBranch) args.push('--base', filter.baseBranch);
  if (filter.headBranch) args.push('--head', filter.headBranch);
  if (filter.author) args.push('--author', filter.author);
  if (filter.label) args.push('--label', filter.label);
  args.push('--limit', String(filter.limit ?? 30));
  return args;
}

function toSummary(raw: RawPrListItem): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author.login,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    state: raw.state as PullRequestState,
    isDraft: raw.isDraft,
    labels: raw.labels.map((label) => label.name),
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * A repo with no GitHub remote (or a call made outside any repo) genuinely
 * has zero pull requests — `gh` reports that as a failure ("no git remotes
 * found") since it needs a remote to infer `owner/name`, but callers should
 * see it as the empty list it is, not an error. Any other failure (bad
 * auth, rate limit, network) still throws.
 *
 * `cwd` scopes which repo `gh` infers `owner/name` from — omit it only when
 * there's genuinely no project in context (`gh` then falls back to the
 * process's own directory, which is what M6 originally shipped with).
 */
export async function listPullRequests(executor: GhExecutor, filter: PullRequestListFilter = {}, cwd?: string): Promise<PullRequestSummary[]> {
  try {
    const raw = await runGhJson<RawPrListItem[]>(executor, prListArgs(filter), cwd !== undefined ? { cwd } : undefined);
    return raw.map(toSummary);
  } catch (error) {
    if (isNoRepoContextError(error)) {
      return [];
    }
    throw error;
  }
}

export interface PullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface PullRequestCommit {
  readonly oid: string;
  readonly messageHeadline: string;
  readonly authors: readonly string[];
}

export interface PullRequestDetail extends PullRequestSummary {
  readonly body: string;
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  readonly mergeStateStatus: string;
  readonly reviewRequests: readonly string[];
  readonly assignees: readonly string[];
  readonly files: readonly PullRequestFile[];
  readonly commits: readonly PullRequestCommit[];
  readonly closingIssuesNumbers: readonly number[];
}

interface RawPrView extends RawPrListItem {
  readonly body: string;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly reviewRequests: readonly { readonly login: string }[];
  readonly assignees: readonly { readonly login: string }[];
  readonly files: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
  readonly commits: readonly { readonly oid: string; readonly messageHeadline: string; readonly authors: readonly { readonly login: string }[] }[];
  readonly closingIssuesReferences: readonly { readonly number: number }[];
}

const DETAIL_JSON_FIELDS = `${LIST_JSON_FIELDS},body,mergeable,mergeStateStatus,reviewRequests,assignees,files,commits,closingIssuesReferences`;

export function prViewArgs(number: number): string[] {
  return ['pr', 'view', String(number), '--json', DETAIL_JSON_FIELDS];
}

export async function viewPullRequest(executor: GhExecutor, number: number): Promise<PullRequestDetail> {
  const raw = await runGhJson<RawPrView>(executor, prViewArgs(number));
  return {
    ...toSummary(raw),
    body: raw.body,
    mergeable: raw.mergeable as PullRequestDetail['mergeable'],
    mergeStateStatus: raw.mergeStateStatus,
    reviewRequests: raw.reviewRequests.map((r) => r.login),
    assignees: raw.assignees.map((a) => a.login),
    files: raw.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    commits: raw.commits.map((c) => ({ oid: c.oid, messageHeadline: c.messageHeadline, authors: c.authors.map((a) => a.login) })),
    closingIssuesNumbers: raw.closingIssuesReferences.map((ref) => ref.number),
  };
}

export interface PullRequestCreateInput {
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly head: string;
  readonly draft?: boolean;
  readonly reviewers?: readonly string[];
  readonly assignees?: readonly string[];
  readonly labels?: readonly string[];
}

/** `gh pr create` has no `--json` output form; it prints the new PR's URL on success, which is the return value here (spec 14.6's "generate/edit title and body"). */
export function prCreateArgs(input: PullRequestCreateInput): string[] {
  const args = ['pr', 'create', '--title', input.title, '--body', input.body, '--base', input.base, '--head', input.head];
  if (input.draft) args.push('--draft');
  if (input.reviewers?.length) args.push('--reviewer', input.reviewers.join(','));
  if (input.assignees?.length) args.push('--assignee', input.assignees.join(','));
  if (input.labels?.length) args.push('--label', input.labels.join(','));
  return args;
}

export async function createPullRequest(executor: GhExecutor, input: PullRequestCreateInput): Promise<{ readonly url: string }> {
  const result = await runGh(executor, prCreateArgs(input));
  return { url: result.stdout.trim().split('\n').pop() ?? '' };
}

export interface PullRequestEditInput {
  readonly addReviewers?: readonly string[];
  readonly addAssignees?: readonly string[];
  readonly addLabels?: readonly string[];
}

export function prEditArgs(number: number, input: PullRequestEditInput): string[] {
  const args = ['pr', 'edit', String(number)];
  if (input.addReviewers?.length) args.push('--add-reviewer', input.addReviewers.join(','));
  if (input.addAssignees?.length) args.push('--add-assignee', input.addAssignees.join(','));
  if (input.addLabels?.length) args.push('--add-label', input.addLabels.join(','));
  return args;
}

export async function editPullRequest(executor: GhExecutor, number: number, input: PullRequestEditInput): Promise<void> {
  await runGh(executor, prEditArgs(number, input));
}

/** `gh pr checkout` performs a real, local, non-destructive branch switch — no confirmation gate needed (unlike merge). */
export function prCheckoutArgs(number: number): string[] {
  return ['pr', 'checkout', String(number)];
}

export async function checkoutPullRequest(executor: GhExecutor, number: number): Promise<void> {
  await runGh(executor, prCheckoutArgs(number));
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PullRequestMergeInput {
  readonly number: number;
  readonly method: MergeMethod;
  readonly deleteBranch?: boolean;
  /** Structural confirmation gate input (spec 14.6). */
  readonly confirmed: boolean;
}

export function prMergeArgs(input: Pick<PullRequestMergeInput, 'number' | 'method' | 'deleteBranch'>): string[] {
  const args = ['pr', 'merge', String(input.number), `--${input.method}`];
  if (input.deleteBranch) args.push('--delete-branch');
  return args;
}

/** Never runs without a confirmed flag (spec 14.6, 39: never silently merge). */
export async function mergePullRequest(executor: GhExecutor, input: PullRequestMergeInput): Promise<void> {
  assertHighImpactGithubActionConfirmed({ action: 'merge-pull-request', confirmed: input.confirmed });
  await runGh(executor, prMergeArgs(input));
}
