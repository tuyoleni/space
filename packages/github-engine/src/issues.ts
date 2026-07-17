/**
 * GH-007: Issues (spec 14.9). List, search, detail, create, edit, assign,
 * label, comment, close/reopen, and the guided "start work" flow, all
 * through `gh`'s structured `--json` output.
 *
 * The start-work flow itself ("refresh the base branch, create a branch
 * with a safe slug, record the issue as the session goal, open the
 * relevant project, link the future PR to the issue") is a cross-cutting
 * orchestration that touches real Git operations, workspace storage, and
 * app navigation — none of which this package owns. `planStartWork`
 * produces the pure, structured plan; the caller (a main-process handler,
 * mirroring git-handlers.ts's DB-vs-real-process split) executes each
 * step with `@space/git-engine` and `@space/storage`.
 */
import { isNoRepoContextError, runGh, runGhJson } from './json';
import type { GhExecutor } from './executor';

export interface IssueSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawIssueListItem {
  readonly number: number;
  readonly title: string;
  readonly author: { readonly login: string };
  readonly state: string;
  readonly labels: readonly { readonly name: string }[];
  readonly assignees: readonly { readonly login: string }[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const LIST_JSON_FIELDS = 'number,title,author,state,labels,assignees,url,createdAt,updatedAt';

export interface IssueListFilter {
  readonly state?: 'open' | 'closed' | 'all';
  readonly labels?: readonly string[];
  readonly assignee?: string;
  /** Free-text search query (GH-007's "search"), passed straight to `gh issue list --search`. */
  readonly search?: string;
  readonly limit?: number;
}

export function issueListArgs(filter: IssueListFilter = {}): string[] {
  const args = ['issue', 'list', '--json', LIST_JSON_FIELDS];
  args.push('--state', filter.state ?? 'open');
  if (filter.labels?.length) args.push('--label', filter.labels.join(','));
  if (filter.assignee) args.push('--assignee', filter.assignee);
  if (filter.search) args.push('--search', filter.search);
  args.push('--limit', String(filter.limit ?? 30));
  return args;
}

function toSummary(raw: RawIssueListItem): IssueSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author.login,
    state: raw.state as IssueSummary['state'],
    labels: raw.labels.map((label) => label.name),
    assignees: raw.assignees.map((assignee) => assignee.login),
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Same reasoning as `listPullRequests`: no remote means genuinely zero
 * issues, not a failure — `gh`'s "no git remotes found" is represented as
 * an empty list rather than propagated as an error. Any other failure
 * still throws. `cwd` scopes which repo `gh` reads — see `listPullRequests`.
 */
export async function listIssues(executor: GhExecutor, filter: IssueListFilter = {}, cwd?: string): Promise<IssueSummary[]> {
  try {
    const raw = await runGhJson<RawIssueListItem[]>(executor, issueListArgs(filter), cwd !== undefined ? { cwd } : undefined);
    return raw.map(toSummary);
  } catch (error) {
    if (isNoRepoContextError(error)) {
      return [];
    }
    throw error;
  }
}

export interface IssueComment {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface IssueDetail extends IssueSummary {
  readonly body: string;
  readonly comments: readonly IssueComment[];
}

interface RawIssueView extends RawIssueListItem {
  readonly body: string;
  readonly comments: readonly { readonly author: { readonly login: string }; readonly body: string; readonly createdAt: string }[];
}

const DETAIL_JSON_FIELDS = `${LIST_JSON_FIELDS},body,comments`;

export function issueViewArgs(number: number): string[] {
  return ['issue', 'view', String(number), '--json', DETAIL_JSON_FIELDS];
}

export async function viewIssue(executor: GhExecutor, number: number): Promise<IssueDetail> {
  const raw = await runGhJson<RawIssueView>(executor, issueViewArgs(number));
  return {
    ...toSummary(raw),
    body: raw.body,
    comments: raw.comments.map((comment) => ({ author: comment.author.login, body: comment.body, createdAt: comment.createdAt })),
  };
}

export interface IssueCreateInput {
  readonly title: string;
  readonly body: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
}

export function issueCreateArgs(input: IssueCreateInput): string[] {
  const args = ['issue', 'create', '--title', input.title, '--body', input.body];
  if (input.labels?.length) args.push('--label', input.labels.join(','));
  if (input.assignees?.length) args.push('--assignee', input.assignees.join(','));
  return args;
}

export async function createIssue(executor: GhExecutor, input: IssueCreateInput): Promise<{ readonly url: string }> {
  const result = await runGh(executor, issueCreateArgs(input));
  return { url: result.stdout.trim().split('\n').pop() ?? '' };
}

export interface IssueEditInput {
  readonly addLabels?: readonly string[];
  readonly removeLabels?: readonly string[];
  readonly addAssignees?: readonly string[];
  readonly removeAssignees?: readonly string[];
  readonly title?: string;
  readonly body?: string;
}

export function issueEditArgs(number: number, input: IssueEditInput): string[] {
  const args = ['issue', 'edit', String(number)];
  if (input.title) args.push('--title', input.title);
  if (input.body) args.push('--body', input.body);
  if (input.addLabels?.length) args.push('--add-label', input.addLabels.join(','));
  if (input.removeLabels?.length) args.push('--remove-label', input.removeLabels.join(','));
  if (input.addAssignees?.length) args.push('--add-assignee', input.addAssignees.join(','));
  if (input.removeAssignees?.length) args.push('--remove-assignee', input.removeAssignees.join(','));
  return args;
}

export async function editIssue(executor: GhExecutor, number: number, input: IssueEditInput): Promise<void> {
  await runGh(executor, issueEditArgs(number, input));
}

export function issueCommentArgs(number: number, body: string): string[] {
  return ['issue', 'comment', String(number), '--body', body];
}

export async function commentOnIssue(executor: GhExecutor, number: number, body: string): Promise<void> {
  await runGh(executor, issueCommentArgs(number, body));
}

export type IssueCloseReason = 'completed' | 'not planned';

export function issueCloseArgs(number: number, reason?: IssueCloseReason, comment?: string): string[] {
  const args = ['issue', 'close', String(number)];
  if (reason) args.push('--reason', reason);
  if (comment) args.push('--comment', comment);
  return args;
}

export async function closeIssue(executor: GhExecutor, number: number, reason?: IssueCloseReason, comment?: string): Promise<void> {
  await runGh(executor, issueCloseArgs(number, reason, comment));
}

export function issueReopenArgs(number: number): string[] {
  return ['issue', 'reopen', String(number)];
}

export async function reopenIssue(executor: GhExecutor, number: number): Promise<void> {
  await runGh(executor, issueReopenArgs(number));
}

const SLUG_MAX_LENGTH = 50;

/** A git-ref-safe branch slug from an issue number and title, e.g. issue-7-add-widget-filtering (spec 14.9: "a safe slug"). */
export function safeBranchSlug(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return `issue-${issueNumber}${slug.length > 0 ? `-${slug}` : ''}`;
}

export interface StartWorkPlan {
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly branchName: string;
  readonly sessionGoal: string;
  /** Body fragment the future PR should include so GitHub auto-links and closes this issue on merge. */
  readonly prLinkFragment: string;
}

/** Pure plan for GH-007's guided "start work" operation — see this module's header comment for why execution is the caller's job. */
export function planStartWork(issue: Pick<IssueSummary, 'number' | 'title'>, baseBranch: string): StartWorkPlan {
  return {
    issueNumber: issue.number,
    baseBranch,
    branchName: safeBranchSlug(issue.number, issue.title),
    sessionGoal: `#${issue.number}: ${issue.title}`,
    prLinkFragment: `Closes #${issue.number}`,
  };
}
