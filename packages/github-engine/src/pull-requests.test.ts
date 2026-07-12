import { HighImpactGithubActionNotConfirmedError } from '@space/domain';
import { describe, expect, it } from 'vitest';
import {
  checkoutPullRequest,
  createPullRequest,
  editPullRequest,
  listPullRequests,
  mergePullRequest,
  prCheckoutArgs,
  prCreateArgs,
  prEditArgs,
  prListArgs,
  prMergeArgs,
  prViewArgs,
  viewPullRequest,
} from './pull-requests';
import type { GhExecutor } from './executor';

const LIST_FIXTURE = [
  {
    number: 42,
    title: 'Add widget filtering',
    author: { login: 'octocat' },
    headRefName: 'feature/filtering',
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    labels: [{ name: 'enhancement' }],
    url: 'https://github.com/acme/widgets/pull/42',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
  },
];

describe('prListArgs', () => {
  it('defaults to open with a limit', () => {
    expect(prListArgs()).toEqual([
      'pr',
      'list',
      '--json',
      'number,title,author,headRefName,baseRefName,state,isDraft,labels,url,createdAt,updatedAt',
      '--state',
      'open',
      '--limit',
      '30',
    ]);
  });

  it('includes filters when supplied', () => {
    const args = prListArgs({ state: 'all', baseBranch: 'main', headBranch: 'feature/x', author: 'octocat', label: 'bug', limit: 5 });
    expect(args).toContain('--base');
    expect(args).toContain('main');
    expect(args).toContain('--head');
    expect(args).toContain('feature/x');
    expect(args).toContain('--author');
    expect(args).toContain('--label');
    expect(args[args.length - 1]).toBe('5');
  });
});

describe('listPullRequests', () => {
  it('maps the structured JSON list into summaries', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(LIST_FIXTURE), stderr: '' });
    const result = await listPullRequests(executor);
    expect(result).toEqual([
      {
        number: 42,
        title: 'Add widget filtering',
        author: 'octocat',
        headRefName: 'feature/filtering',
        baseRefName: 'main',
        state: 'OPEN',
        isDraft: false,
        labels: ['enhancement'],
        url: 'https://github.com/acme/widgets/pull/42',
        createdAt: '2026-07-01T10:00:00Z',
        updatedAt: '2026-07-02T10:00:00Z',
      },
    ]);
  });
});

const VIEW_FIXTURE = {
  ...LIST_FIXTURE[0],
  body: 'This PR adds filtering.\n\nCloses #7',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewRequests: [{ login: 'reviewer1' }],
  assignees: [{ login: 'octocat' }],
  files: [{ path: 'src/filter.ts', additions: 40, deletions: 2 }],
  commits: [{ oid: 'abc123', messageHeadline: 'Add filter', authors: [{ login: 'octocat' }] }],
  closingIssuesReferences: [{ number: 7 }],
};

describe('prViewArgs / viewPullRequest', () => {
  it('requests the full detail field set', () => {
    expect(prViewArgs(42)).toEqual([
      'pr',
      'view',
      '42',
      '--json',
      'number,title,author,headRefName,baseRefName,state,isDraft,labels,url,createdAt,updatedAt,body,mergeable,mergeStateStatus,reviewRequests,assignees,files,commits,closingIssuesReferences',
    ]);
  });

  it('parses files, commits, reviewers, assignees, and linked issues', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(VIEW_FIXTURE), stderr: '' });
    const detail = await viewPullRequest(executor, 42);
    expect(detail.mergeable).toBe('MERGEABLE');
    expect(detail.reviewRequests).toEqual(['reviewer1']);
    expect(detail.assignees).toEqual(['octocat']);
    expect(detail.files).toEqual([{ path: 'src/filter.ts', additions: 40, deletions: 2 }]);
    expect(detail.commits).toEqual([{ oid: 'abc123', messageHeadline: 'Add filter', authors: ['octocat'] }]);
    expect(detail.closingIssuesNumbers).toEqual([7]);
  });
});

describe('prCreateArgs / createPullRequest', () => {
  it('builds title/body/base/head plus optional reviewers/assignees/labels/draft', () => {
    expect(
      prCreateArgs({
        title: 'Add filtering',
        body: 'Adds filtering.',
        base: 'main',
        head: 'feature/filtering',
        draft: true,
        reviewers: ['r1', 'r2'],
        assignees: ['a1'],
        labels: ['enhancement'],
      }),
    ).toEqual([
      'pr',
      'create',
      '--title',
      'Add filtering',
      '--body',
      'Adds filtering.',
      '--base',
      'main',
      '--head',
      'feature/filtering',
      '--draft',
      '--reviewer',
      'r1,r2',
      '--assignee',
      'a1',
      '--label',
      'enhancement',
    ]);
  });

  it('returns the created PR URL parsed from stdout (no --json form exists for create)', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: 'https://github.com/acme/widgets/pull/43\n', stderr: '' });
    const result = await createPullRequest(executor, { title: 't', body: 'b', base: 'main', head: 'feature/x' });
    expect(result.url).toBe('https://github.com/acme/widgets/pull/43');
  });
});

describe('prEditArgs / editPullRequest', () => {
  it('builds add-reviewer/add-assignee/add-label flags', () => {
    expect(prEditArgs(42, { addReviewers: ['r1'], addAssignees: ['a1'], addLabels: ['bug'] })).toEqual([
      'pr',
      'edit',
      '42',
      '--add-reviewer',
      'r1',
      '--add-assignee',
      'a1',
      '--add-label',
      'bug',
    ]);
  });

  it('runs for real through the injected executor', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['pr', 'edit', '42', '--add-label', 'bug']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(editPullRequest(executor, 42, { addLabels: ['bug'] })).resolves.toBeUndefined();
  });
});

describe('prCheckoutArgs / checkoutPullRequest', () => {
  it('builds and runs pr checkout', async () => {
    expect(prCheckoutArgs(42)).toEqual(['pr', 'checkout', '42']);
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['pr', 'checkout', '42']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(checkoutPullRequest(executor, 42)).resolves.toBeUndefined();
  });
});

describe('prMergeArgs / mergePullRequest', () => {
  it('builds the merge method flag and optional delete-branch', () => {
    expect(prMergeArgs({ number: 42, method: 'squash', deleteBranch: true })).toEqual(['pr', 'merge', '42', '--squash', '--delete-branch']);
  });

  it('refuses to merge without confirmation and never calls gh', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(mergePullRequest(executor, { number: 42, method: 'squash', confirmed: false })).rejects.toThrow(
      HighImpactGithubActionNotConfirmedError,
    );
    expect(called).toBe(false);
  });

  it('merges for real once confirmed', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['pr', 'merge', '42', '--merge']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(mergePullRequest(executor, { number: 42, method: 'merge', confirmed: true })).resolves.toBeUndefined();
  });
});
