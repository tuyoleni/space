import { describe, expect, it } from 'vitest';
import {
  closeIssue,
  commentOnIssue,
  createIssue,
  editIssue,
  issueCloseArgs,
  issueCommentArgs,
  issueCreateArgs,
  issueEditArgs,
  issueListArgs,
  issueReopenArgs,
  issueViewArgs,
  listIssues,
  planStartWork,
  reopenIssue,
  safeBranchSlug,
  viewIssue,
} from './issues';
import type { GhExecutor } from './executor';

const LIST_FIXTURE = [
  {
    number: 7,
    title: 'Add widget filtering',
    author: { login: 'octocat' },
    state: 'OPEN',
    labels: [{ name: 'enhancement' }],
    assignees: [{ login: 'octocat' }],
    url: 'https://github.com/acme/widgets/issues/7',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
  },
];

describe('issueListArgs / listIssues', () => {
  it('defaults to open with a limit and supports search', () => {
    const args = issueListArgs({ search: 'filtering', labels: ['bug'], assignee: 'octocat' });
    expect(args).toContain('--search');
    expect(args).toContain('filtering');
    expect(args).toContain('--label');
    expect(args).toContain('--assignee');
  });

  it('parses the structured list', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(LIST_FIXTURE), stderr: '' });
    const result = await listIssues(executor);
    expect(result[0]).toEqual({
      number: 7,
      title: 'Add widget filtering',
      author: 'octocat',
      state: 'OPEN',
      labels: ['enhancement'],
      assignees: ['octocat'],
      url: 'https://github.com/acme/widgets/issues/7',
      createdAt: '2026-07-01T10:00:00Z',
      updatedAt: '2026-07-02T10:00:00Z',
    });
  });

  it('resolves to an empty list when the repo has no remote, instead of throwing', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'no git remotes found\n' });
    const result = await listIssues(executor);
    expect(result).toEqual([]);
  });

  it('still throws for a real failure (e.g. auth)', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 401: Bad credentials\n' });
    await expect(listIssues(executor)).rejects.toThrow('Bad credentials');
  });
});

describe('issueViewArgs / viewIssue', () => {
  it('parses body and comments', async () => {
    const fixture = {
      ...LIST_FIXTURE[0],
      body: 'Please add filtering.',
      comments: [{ author: { login: 'reviewer1' }, body: 'Sounds good', createdAt: '2026-07-01T11:00:00Z' }],
    };
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(issueViewArgs(7));
      return { exitCode: 0, stdout: JSON.stringify(fixture), stderr: '' };
    };
    const detail = await viewIssue(executor, 7);
    expect(detail.body).toBe('Please add filtering.');
    expect(detail.comments).toEqual([{ author: 'reviewer1', body: 'Sounds good', createdAt: '2026-07-01T11:00:00Z' }]);
  });
});

describe('issueCreateArgs / createIssue', () => {
  it('builds title/body plus optional labels/assignees', () => {
    expect(issueCreateArgs({ title: 'Bug', body: 'It broke', labels: ['bug'], assignees: ['octocat'] })).toEqual([
      'issue',
      'create',
      '--title',
      'Bug',
      '--body',
      'It broke',
      '--label',
      'bug',
      '--assignee',
      'octocat',
    ]);
  });

  it('returns the created issue URL', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: 'https://github.com/acme/widgets/issues/8\n', stderr: '' });
    expect(await createIssue(executor, { title: 'Bug', body: 'It broke' })).toEqual({ url: 'https://github.com/acme/widgets/issues/8' });
  });
});

describe('issueEditArgs / editIssue', () => {
  it('builds add/remove label and assignee flags', () => {
    expect(issueEditArgs(7, { addLabels: ['bug'], removeAssignees: ['octocat'] })).toEqual([
      'issue',
      'edit',
      '7',
      '--add-label',
      'bug',
      '--remove-assignee',
      'octocat',
    ]);
  });

  it('runs for real', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['issue', 'edit', '7', '--add-label', 'bug']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(editIssue(executor, 7, { addLabels: ['bug'] })).resolves.toBeUndefined();
  });
});

describe('comment / close / reopen', () => {
  it('builds and runs comment', async () => {
    expect(issueCommentArgs(7, 'thanks')).toEqual(['issue', 'comment', '7', '--body', 'thanks']);
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['issue', 'comment', '7', '--body', 'thanks']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(commentOnIssue(executor, 7, 'thanks')).resolves.toBeUndefined();
  });

  it('builds and runs close with reason and comment', async () => {
    expect(issueCloseArgs(7, 'completed', 'done')).toEqual(['issue', 'close', '7', '--reason', 'completed', '--comment', 'done']);
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['issue', 'close', '7', '--reason', 'completed']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(closeIssue(executor, 7, 'completed')).resolves.toBeUndefined();
  });

  it('builds and runs reopen', async () => {
    expect(issueReopenArgs(7)).toEqual(['issue', 'reopen', '7']);
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['issue', 'reopen', '7']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(reopenIssue(executor, 7)).resolves.toBeUndefined();
  });
});

describe('safeBranchSlug', () => {
  it('produces a lowercase, dash-separated, ref-safe slug prefixed with the issue number', () => {
    expect(safeBranchSlug(7, 'Add widget filtering')).toBe('issue-7-add-widget-filtering');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(safeBranchSlug(12, "Fix: crash on 'save' (urgent!!)")).toBe('issue-12-fix-crash-on-save-urgent');
  });

  it('falls back to just the issue number for an empty or fully-punctuation title', () => {
    expect(safeBranchSlug(3, '!!!')).toBe('issue-3');
  });

  it('truncates very long titles', () => {
    const title = 'a'.repeat(100);
    const slug = safeBranchSlug(9, title);
    expect(slug.length).toBeLessThanOrEqual('issue-9-'.length + 50);
    expect(slug.startsWith('issue-9-')).toBe(true);
  });
});

describe('planStartWork', () => {
  it('produces a branch name, session goal, and PR link fragment from the issue', () => {
    const plan = planStartWork({ number: 7, title: 'Add widget filtering' }, 'main');
    expect(plan).toEqual({
      issueNumber: 7,
      baseBranch: 'main',
      branchName: 'issue-7-add-widget-filtering',
      sessionGoal: '#7: Add widget filtering',
      prLinkFragment: 'Closes #7',
    });
  });
});
