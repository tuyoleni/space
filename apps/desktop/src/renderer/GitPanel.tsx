import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Plus, RefreshCw } from 'lucide-react';
import type { GitRefEntry, GitStatusSummary, Project } from '@space/contracts';
import { Button, InlineBanner, Input, Select, Textarea } from '@space/ui';
import { toErrorMessage } from './errors';

/**
 * Minimal M5 Git surface (spec 36.5 exit criteria: "daily Git work can be
 * completed without leaving Space"): status, stage/unstage, commit,
 * branch create/switch, fetch/pull/push, conflict continue/abort, and a
 * recent-history list — all through window.space.git (contextBridge),
 * mirroring TerminalPanel's shape as the M4 precedent for a project-scoped
 * panel. Status entries (staged/unstaged/history) are refreshed on demand
 * (button + after each mutation) rather than pushed from a live filesystem
 * watcher — that scope cut still stands. Ahead/behind is different: it
 * reflects the local remote-tracking ref, which only moves on `git fetch`,
 * so we fetch on open and on a background interval below to keep it from
 * silently going stale (a real gap: a freshly opened project could report
 * "up to date" while sitting behind the remote).
 */
interface GitPanelProps {
  readonly project: Project;
}

const BACKGROUND_FETCH_INTERVAL_MS = 5 * 60 * 1000;

function formatLastFetched(lastFetchedAt: number | null): string {
  if (lastFetchedAt === null) {
    return 'not fetched yet';
  }
  const minutes = Math.floor((Date.now() - lastFetchedAt) / 60_000);
  if (minutes < 1) {
    return 'fetched just now';
  }
  if (minutes === 1) {
    return 'fetched 1m ago';
  }
  return `fetched ${minutes}m ago`;
}

export function GitPanel({ project }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [branches, setBranches] = useState<GitRefEntry[]>([]);
  const [message, setMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const refreshStatus = useCallback(async () => {
    setStatus(await window.space.git.status({ projectId: project.id }));
  }, [project.id]);

  const refreshBranches = useCallback(async () => {
    setBranches(await window.space.git.listBranches({ projectId: project.id }));
  }, [project.id]);

  // Best-effort: no upstream configured, no network, or auth failure should
  // not block the panel from showing local status, so errors are swallowed
  // here. The explicit Fetch button (handleFetch below) still surfaces them.
  const backgroundFetch = useCallback(async () => {
    try {
      await window.space.git.fetch({ projectId: project.id });
      setLastFetchedAt(Date.now());
    } catch {
      // ignored — see comment above
    }
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      await backgroundFetch();
      await refreshStatus();
      await refreshBranches();
    })();
  }, [backgroundFetch, refreshStatus, refreshBranches]);

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        await backgroundFetch();
        await refreshStatus();
      })();
    }, BACKGROUND_FETCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [backgroundFetch, refreshStatus]);

  // Keeps the "fetched Xm ago" label accurate between background fetches.
  useEffect(() => {
    const id = setInterval(() => forceTick((tick) => tick + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
      await refreshStatus();
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
      await Promise.all([refreshStatus(), refreshBranches()]);
    });
  }

  function handleFetch(): void {
    void guarded(async () => {
      await window.space.git.fetch({ projectId: project.id });
      setLastFetchedAt(Date.now());
      await refreshStatus();
    });
  }

  function handlePull(): void {
    void guarded(async () => {
      await window.space.git.pull({ projectId: project.id, mode: 'merge' });
      await refreshStatus();
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
      await refreshStatus();
    });
  }

  function handleAbort(): void {
    void guarded(async () => {
      await window.space.git.abortConflict({ projectId: project.id });
      await refreshStatus();
    });
  }

  if (!status) {
    return <p className="text-sm text-fg-muted">Loading Git status&hellip;</p>;
  }

  const staged = status.entries.filter(
    (entry) => entry.kind !== 'untracked' && entry.kind !== 'ignored' && entry.kind !== 'unmerged' && entry.indexStatus !== '.',
  );
  const unstaged = status.entries.filter(
    (entry) => entry.kind === 'untracked' || (entry.kind !== 'ignored' && entry.kind !== 'unmerged' && entry.worktreeStatus !== '.'),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <GitBranch size={14} className="text-fg-muted" />
          <span className="font-medium text-fg">
            {status.branch.detached ? '(detached HEAD)' : status.branch.branchName ?? '(no commits yet)'}
          </span>
          {status.branch.upstream && (
            <span className="text-fg-muted">
              → {status.branch.upstream} (+{status.branch.ahead ?? 0}/-{status.branch.behind ?? 0})
            </span>
          )}
          <span className="text-xs text-fg-faint">{formatLastFetched(lastFetchedAt)}</span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void refreshStatus()} disabled={busy}>
            <RefreshCw size={13} />
          </Button>
          <Button size="sm" variant="secondary" onClick={handleFetch} disabled={busy}>
            Fetch
          </Button>
          <Button size="sm" variant="secondary" onClick={handlePull} disabled={busy}>
            <ArrowDown size={13} /> Pull
          </Button>
          <Button size="sm" variant="primary" onClick={handlePush} disabled={busy || !status.branch.branchName}>
            <ArrowUp size={13} /> Push
          </Button>
        </div>
      </div>

      {status.operationState.kind !== 'none' && (
        <InlineBanner variant="error">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              In progress: {status.operationState.kind}
              {status.conflictedFiles.length > 0 && ` — conflicts in ${status.conflictedFiles.join(', ')}`}
            </span>
            <Button size="sm" variant="secondary" onClick={handleContinue} disabled={busy}>
              Continue
            </Button>
            <Button size="sm" variant="ghost" onClick={handleAbort} disabled={busy}>
              Abort
            </Button>
          </div>
        </InlineBanner>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">Unstaged ({unstaged.length})</p>
          <ul className="flex flex-col gap-1">
            {unstaged.map((entry) => (
              <li key={entry.path} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover">
                <span className="truncate text-fg-muted">{entry.path}</span>
                <Button size="sm" variant="ghost" onClick={() => toggleStage(entry.path, false)} disabled={busy}>
                  Stage
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">Staged ({staged.length})</p>
          <ul className="flex flex-col gap-1">
            {staged.map((entry) => (
              <li key={entry.path} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover">
                <span className="truncate text-fg-muted">{entry.path}</span>
                <Button size="sm" variant="ghost" onClick={() => toggleStage(entry.path, true)} disabled={busy}>
                  Unstage
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          disabled={busy}
        />
        <div>
          <Button size="sm" variant="primary" onClick={handleCommit} disabled={busy || !message.trim() || staged.length === 0}>
            Commit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel="Switch branch"
          value={undefined}
          placeholder="Switch branch…"
          onValueChange={handleSwitchBranch}
          disabled={busy}
          options={branches
            .filter((branch) => branch.kind === 'local-branch')
            .map((branch) => ({ value: branch.refname, label: branch.isHead ? `${branch.shortName} (current)` : branch.shortName }))}
        />
        <Input
          placeholder="New branch name"
          aria-label="New branch name"
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          disabled={busy}
          className="w-48"
        />
        <Button size="sm" variant="secondary" onClick={handleCreateBranch} disabled={busy || !newBranchName.trim()}>
          <Plus size={13} /> Create branch
        </Button>
      </div>

      {error && <InlineBanner variant="error">{error}</InlineBanner>}
    </div>
  );
}
