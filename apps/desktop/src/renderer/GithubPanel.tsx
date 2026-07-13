import { useCallback, useState } from 'react';
import type { GithubAuthReport, GithubIssueSummary, GithubPullRequestSummary, TerminalSessionInfo } from '@space/contracts';
import { toErrorMessage } from './errors';
import { TerminalPanel } from './TerminalPanel';

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
 * The interactive `gh auth login` PTY reuses TerminalPanel verbatim: the
 * session it renders was created through the exact same PTY host and
 * `terminal:*` IPC channels a regular shell uses (spec 14.3), so no
 * second terminal-rendering implementation is needed here.
 */
interface GithubPanelProps {
  readonly workspaceId: string;
}

export function GithubPanel({ workspaceId }: GithubPanelProps) {
  const [report, setReport] = useState<GithubAuthReport | null>(null);
  const [loginSession, setLoginSession] = useState<TerminalSessionInfo | null>(null);
  const [prs, setPrs] = useState<GithubPullRequestSummary[]>([]);
  const [issues, setIssues] = useState<GithubIssueSummary[]>([]);
  const [prTitle, setPrTitle] = useState('');
  const [prBase, setPrBase] = useState('main');
  const [prHead, setPrHead] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshReport = useCallback(async () => {
    setReport(await window.space.github.authReport({ workspaceId }));
  }, [workspaceId]);

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleSignIn(): void {
    void guarded(async () => {
      const { sessionId } = await window.space.github.authStartLogin({ workspaceId, webFlow: true });
      setLoginSession({
        id: sessionId,
        workspaceId,
        projectId: null,
        shell: 'gh',
        cwd: '',
        pid: 0,
        state: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        lastOutputAt: null,
      });
    });
  }

  function handleSignOut(): void {
    void guarded(async () => {
      await window.space.github.authLogout({ workspaceId });
      await refreshReport();
    });
  }

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
    <section style={{ border: '1px dashed #666', borderRadius: 6, padding: '0.75rem', marginTop: '1rem' }}>
      <h2>GitHub</h2>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={busy} onClick={() => void guarded(refreshReport)}>
          Refresh auth status
        </button>
        <button type="button" disabled={busy} onClick={handleSignIn}>
          Sign in&hellip;
        </button>
        <button type="button" disabled={busy || !report?.authenticated} onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      {report && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
          <div>CLI installed: {report.cliInstalled ? `yes (${report.cliVersion ?? 'unknown version'})` : 'no'}</div>
          <div>
            Authenticated: {report.authenticated ? 'yes' : 'no'}
            {report.activeAccount && ` as ${report.activeAccount.account} on ${report.activeAccount.host}`}
          </div>
          <div>Git protocol: {report.gitProtocol ?? 'unknown'}</div>
          <div>Token source: {report.tokenSourceStrategy}</div>
        </div>
      )}

      {loginSession && (
        <div style={{ marginTop: '0.5rem' }}>
          <em>Follow the instructions below to finish signing in, then refresh auth status.</em>
          <TerminalPanel session={loginSession} />
        </div>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div>
          <h3>Pull requests</h3>
          <button type="button" disabled={busy} onClick={handleListPrs}>
            List open PRs
          </button>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1rem', fontSize: '0.85rem' }}>
            {prs.map((pr) => (
              <li key={pr.number}>
                #{pr.number} {pr.title} ({pr.headRefName} &rarr; {pr.baseRefName}){' '}
                <button type="button" disabled={busy} onClick={() => handleMergePr(pr)}>
                  Merge
                </button>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy}>
            <legend>Create PR from current branch</legend>
            <input type="text" placeholder="Title" aria-label="Pull request title" value={prTitle} onChange={(event) => setPrTitle(event.target.value)} />
            <input type="text" placeholder="Head branch" aria-label="Head branch" value={prHead} onChange={(event) => setPrHead(event.target.value)} />
            <input type="text" placeholder="Base branch" aria-label="Base branch" value={prBase} onChange={(event) => setPrBase(event.target.value)} />
            <button type="button" disabled={!prTitle.trim() || !prHead.trim()} onClick={handleCreatePr}>
              Create PR
            </button>
          </fieldset>
        </div>

        <div>
          <h3>Issues</h3>
          <button type="button" disabled={busy} onClick={handleListIssues}>
            List open issues
          </button>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1rem', fontSize: '0.85rem' }}>
            {issues.map((issue) => (
              <li key={issue.number}>
                #{issue.number} {issue.title}
              </li>
            ))}
          </ul>
          <fieldset disabled={busy}>
            <legend>Create issue</legend>
            <input type="text" placeholder="Title" aria-label="Issue title" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
            <button type="button" disabled={!issueTitle.trim()} onClick={handleCreateIssue}>
              Create issue
            </button>
          </fieldset>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
