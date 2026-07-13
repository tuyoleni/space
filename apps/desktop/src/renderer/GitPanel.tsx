import { useCallback, useEffect, useState } from 'react';
import type { GitCommitNode, GitRefEntry, GitStatusSummary, Project } from '@space/contracts';
import { toErrorMessage } from './errors';

/**
 * Minimal M5 Git surface (spec 36.5 exit criteria: "daily Git work can be
 * completed without leaving Space"): status, stage/unstage, commit,
 * branch create/switch, fetch/pull/push, conflict continue/abort, and a
 * recent-history list — all through window.space.git (contextBridge),
 * mirroring TerminalPanel's shape as the M4 precedent for a project-scoped
 * panel. Status is refreshed on demand (button + after each mutation)
 * rather than pushed from a live filesystem watcher — a deliberate scope
 * simplification noted in git-handlers.ts's history.
 */
interface GitPanelProps {
  readonly project: Project;
}

export function GitPanel({ project }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [branches, setBranches] = useState<GitRefEntry[]>([]);
  const [commits, setCommits] = useState<GitCommitNode[]>([]);
  const [message, setMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await window.space.git.status({ projectId: project.id }));
  }, [project.id]);

  const refreshBranches = useCallback(async () => {
    setBranches(await window.space.git.listBranches({ projectId: project.id }));
  }, [project.id]);

  const refreshHistory = useCallback(async () => {
    const page = await window.space.git.loadHistory({ projectId: project.id, offset: 0, count: 20 });
    setCommits([...page.commits]);
  }, [project.id]);

  useEffect(() => {
    void refreshStatus();
    void refreshBranches();
    void refreshHistory();
  }, [refreshStatus, refreshBranches, refreshHistory]);

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

  function toggleStage(path: string, currentlyStaged: boolean): void {
    void guarded(async () => {
      if (currentlyStaged) {
        await window.space.git.unstage({ projectId: project.id, paths: [path] });
      } else {
        await window.space.git.stage({ projectId: project.id, paths: [path] });
      }
      await refreshStatus();
    });
  }

  function handleCommit(): void {
    if (!message.trim()) {
      return;
    }
    void guarded(async () => {
      await window.space.git.commit({ projectId: project.id, message: message.trim() });
      setMessage('');
      await Promise.all([refreshStatus(), refreshHistory()]);
    });
  }

  function handleCreateBranch(): void {
    if (!newBranchName.trim()) {
      return;
    }
    void guarded(async () => {
      await window.space.git.createBranch({ projectId: project.id, name: newBranchName.trim() });
      setNewBranchName('');
      await refreshBranches();
    });
  }

  function handleSwitchBranch(name: string): void {
    void guarded(async () => {
      await window.space.git.switchBranch({ projectId: project.id, name });
      await Promise.all([refreshStatus(), refreshBranches(), refreshHistory()]);
    });
  }

  function handleFetch(): void {
    void guarded(async () => {
      await window.space.git.fetch({ projectId: project.id });
      await refreshStatus();
    });
  }

  function handlePull(): void {
    void guarded(async () => {
      await window.space.git.pull({ projectId: project.id, mode: 'merge' });
      await Promise.all([refreshStatus(), refreshHistory()]);
    });
  }

  function handlePush(): void {
    const branchName = status?.branch.branchName;
    if (!branchName) {
      return;
    }
    void guarded(async () => {
      await window.space.git.push({ projectId: project.id, branch: branchName, setUpstream: !status?.branch.upstream });
      await refreshStatus();
    });
  }

  function handleContinue(): void {
    void guarded(async () => {
      await window.space.git.continueConflict({ projectId: project.id });
      await Promise.all([refreshStatus(), refreshHistory()]);
    });
  }

  function handleAbort(): void {
    void guarded(async () => {
      await window.space.git.abortConflict({ projectId: project.id });
      await refreshStatus();
    });
  }

  if (!status) {
    return <p>Loading Git status&hellip;</p>;
  }

  const staged = status.entries.filter(
    (entry) => entry.kind !== 'untracked' && entry.kind !== 'ignored' && entry.kind !== 'unmerged' && entry.indexStatus !== '.',
  );
  const unstaged = status.entries.filter(
    (entry) => entry.kind === 'untracked' || (entry.kind !== 'ignored' && entry.kind !== 'unmerged' && entry.worktreeStatus !== '.'),
  );

  return (
    <div style={{ border: '1px dashed #666', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem' }}>
      <div>
        <strong>Branch:</strong> {status.branch.detached ? '(detached HEAD)' : status.branch.branchName ?? '(no commits yet)'}
        {status.branch.upstream ? ` → ${status.branch.upstream} (+${status.branch.ahead ?? 0}/-${status.branch.behind ?? 0})` : ''}
      </div>

      {status.operationState.kind !== 'none' && (
        <div style={{ color: 'darkorange', marginTop: '0.5rem' }}>
          In progress: {status.operationState.kind}
          {status.conflictedFiles.length > 0 && ` — conflicts in ${status.conflictedFiles.join(', ')}`}
          <div style={{ marginTop: '0.25rem' }}>
            <button type="button" disabled={busy} onClick={handleContinue}>
              Continue
            </button>{' '}
            <button type="button" disabled={busy} onClick={handleAbort}>
              Abort
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <div>
          <div>
            <em>Unstaged ({unstaged.length})</em>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {unstaged.map((entry) => (
              <li key={entry.path}>
                {entry.path}{' '}
                <button type="button" disabled={busy} onClick={() => toggleStage(entry.path, false)}>
                  Stage
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div>
            <em>Staged ({staged.length})</em>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {staged.map((entry) => (
              <li key={entry.path}>
                {entry.path}{' '}
                <button type="button" disabled={busy} onClick={() => toggleStage(entry.path, true)}>
                  Unstage
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ marginTop: '0.5rem' }}>
        <textarea
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          style={{ width: '100%' }}
          disabled={busy}
        />
        <button type="button" disabled={busy || !message.trim() || staged.length === 0} onClick={handleCommit}>
          Commit
        </button>
      </div>

      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={handleFetch}>
          Fetch
        </button>
        <button type="button" disabled={busy} onClick={handlePull}>
          Pull
        </button>
        <button type="button" disabled={busy || !status.branch.branchName} onClick={handlePush}>
          Push
        </button>
        <button type="button" disabled={busy} onClick={() => void refreshStatus()}>
          Refresh status
        </button>
      </div>

      <div style={{ marginTop: '0.5rem' }}>
        <select
          disabled={busy}
          aria-label="Switch branch"
          onChange={(event) => event.target.value && handleSwitchBranch(event.target.value)}
          value=""
        >
          <option value="" disabled>
            Switch branch&hellip;
          </option>
          {branches
            .filter((branch) => branch.kind === 'local-branch')
            .map((branch) => (
              <option key={branch.refname} value={branch.shortName}>
                {branch.shortName}
                {branch.isHead ? ' (current)' : ''}
              </option>
            ))}
        </select>{' '}
        <input
          type="text"
          placeholder="New branch name"
          aria-label="New branch name"
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          disabled={busy}
        />
        <button type="button" disabled={busy || !newBranchName.trim()} onClick={handleCreateBranch}>
          Create branch
        </button>
      </div>

      <div style={{ marginTop: '0.5rem' }}>
        <em>Recent history</em>
        <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem' }}>
          {commits.map((commit) => (
            <li key={commit.sha}>
              <code>{commit.sha.slice(0, 7)}</code> {commit.subject} &mdash; {commit.authorName}
            </li>
          ))}
        </ul>
      </div>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}
