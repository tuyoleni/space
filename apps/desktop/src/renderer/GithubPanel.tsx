import { useState } from 'react';
import { GitPullRequest } from 'lucide-react';
import type { GithubIssueSummary, GithubPullRequestSummary } from '@space/contracts';
import { Badge, Button, Input, useToast } from '@space/ui';
import { friendlyGithubErrorMessage } from './errors';
import { useGithubAuth } from './useGithubAuth';
import { GithubAuthControls } from './GithubAuthControls';

/**
 * Minimal M6 GitHub surface (spec 36.6 exit criteria: publish, PR,
 * checks, merge, release in a disposable test organisation) — auth,
 * pull request list/create/merge, and issue list/create, all through
 * window.space.github (contextBridge). Mirrors GitPanel's shape as the
 * M5 precedent for a workspace-scoped panel.
 *
 * github-handlers.ts's full GH-001..009 surface (repository publish,
 * checks, Actions, the rest of Issues, and Releases) is wired end to end
 * at the IPC layer (see ipc.ts/preload.ts/space-api.ts) and reachable via
 * window.space.github — but does not have dedicated controls here, since
 * repository publish, release creation, and the guided issue "start
 * work" flow are inherently project-scoped operations (they resolve a
 * project's repositoryRoot server-side) and this panel is deliberately
 * workspace-scoped, the same way GitPanel is deliberately project-scoped.
 * Surfacing them well means picking a project first, which is a real UX
 * decision (a project-scoped GithubPanel instance, or a project picker
 * inside this one) left for whoever builds that flow next rather than
 * bolted on here as an afterthought.
 *
 * Auth status and sign in/out live in `useGithubAuth` + `GithubAuthControls`,
 * shared with the GitHub screen's account card.
 */
interface GithubPanelProps {
  readonly workspaceId: string;
}

export function GithubPanel({ workspaceId }: GithubPanelProps) {
  const { report, loginSession, busy: authBusy, refreshReport, signIn, signOut } = useGithubAuth(workspaceId);
  const [prs, setPrs] = useState<GithubPullRequestSummary[]>([]);
  const [issues, setIssues] = useState<GithubIssueSummary[]>([]);
  const [prTitle, setPrTitle] = useState('');
  const [prBase, setPrBase] = useState('main');
  const [prHead, setPrHead] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      toast({ variant: 'error', message: friendlyGithubErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const authenticated = report?.authenticated ?? false;

  function handleListPrs(): void {
    void guarded(async () => {
      setPrs(await window.space.github.prList({ workspaceId, state: 'open' }));
    });
  }

  function handleCreatePr(): void {
    if (!prTitle.trim() || !prHead.trim()) {
      return;
    }
    void guarded(async () => {
      await window.space.github.prCreate({ workspaceId, title: prTitle.trim(), body: '', base: prBase.trim() || 'main', head: prHead.trim() });
      setPrTitle('');
      setPrHead('');
      await handleListPrsInternal();
    });
  }

  async function handleListPrsInternal(): Promise<void> {
    setPrs(await window.space.github.prList({ workspaceId, state: 'open' }));
  }

  /** `confirmed` is a structural gate (@space/domain) the handler enforces server-side — this dialog is what actually sets it true, not a UI-only nicety. */
  function handleMergePr(pr: GithubPullRequestSummary): void {
    const confirmed = window.confirm(`Merge #${pr.number} "${pr.title}" (squash) into ${pr.baseRefName}?`);
    if (!confirmed) {
      return;
    }
    void guarded(async () => {
      await window.space.github.prMerge({ workspaceId, number: pr.number, method: 'squash', confirmed: true });
      await handleListPrsInternal();
    });
  }

  function handleListIssues(): void {
    void guarded(async () => {
      setIssues(await window.space.github.issueList({ workspaceId, state: 'open' }));
    });
  }

  function handleCreateIssue(): void {
    if (!issueTitle.trim()) {
      return;
    }
    void guarded(async () => {
      await window.space.github.issueCreate({ workspaceId, title: issueTitle.trim(), body: '' });
      setIssueTitle('');
      setIssues(await window.space.github.issueList({ workspaceId, state: 'open' }));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <GithubAuthControls
        report={report}
        loginSession={loginSession}
        busy={authBusy}
        onRefresh={() => void refreshReport()}
        onSignIn={signIn}
        onSignOut={signOut}
      />

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <GitPullRequest size={14} /> Pull requests
          </h3>
          <Button size="sm" variant="ghost" disabled={busy || !authenticated} onClick={handleListPrs}>
            List open PRs
          </Button>
          <ul className="my-2 flex flex-col gap-1">
            {prs.map((pr) => (
              <li key={pr.number} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover">
                <span className="truncate text-fg">
                  #{pr.number} {pr.title}{' '}
                  <span className="text-fg-faint">
                    ({pr.headRefName} → {pr.baseRefName})
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={busy || !authenticated} onClick={() => handleMergePr(pr)}>
                  Merge
                </Button>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy || !authenticated} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">Create PR from current branch</legend>
            <Input placeholder="Title" aria-label="Pull request title" value={prTitle} onChange={(event) => setPrTitle(event.target.value)} />
            <Input placeholder="Head branch" aria-label="Head branch" value={prHead} onChange={(event) => setPrHead(event.target.value)} />
            <Input placeholder="Base branch" aria-label="Base branch" value={prBase} onChange={(event) => setPrBase(event.target.value)} />
            <div>
              <Button size="sm" variant="primary" disabled={!authenticated || !prTitle.trim() || !prHead.trim()} onClick={handleCreatePr}>
                Create PR
              </Button>
            </div>
          </fieldset>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Issues</h3>
          <Button size="sm" variant="ghost" disabled={busy || !authenticated} onClick={handleListIssues}>
            List open issues
          </Button>
          <ul className="my-2 flex flex-col gap-1">
            {issues.map((issue) => (
              <li key={issue.number} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm">
                <Badge>#{issue.number}</Badge>
                <span className="truncate text-fg">{issue.title}</span>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy || !authenticated} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">Create issue</legend>
            <Input placeholder="Title" aria-label="Issue title" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
            <div>
              <Button size="sm" variant="primary" disabled={!authenticated || !issueTitle.trim()} onClick={handleCreateIssue}>
                Create issue
              </Button>
            </div>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
