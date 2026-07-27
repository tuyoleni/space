import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, CloudDownload, Loader2, ShieldCheck } from 'lucide-react';
import type { AiGitSyncPhase, GitStatusSummary, Project } from '@space/contracts';
import { Badge, Button, Dialog, InlineBanner } from '@space/ui';
import { toErrorMessage } from './errors';

interface GuidedSyncDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: Project | null;
  readonly onChanged?: () => void | Promise<void>;
}

type UiPhase = 'idle' | 'fetching' | AiGitSyncPhase;

function localChangeCount(status: GitStatusSummary): number {
  return status.entries.filter((entry) => entry.kind !== 'ignored' && entry.kind !== 'unmerged').length;
}

function localGuidance(phase: AiGitSyncPhase, status: GitStatusSummary, error?: string): string {
  const changes = localChangeCount(status);
  switch (phase) {
    case 'fetched':
      return 'Remote information is current. Space is checking whether this branch has incoming commits.';
    case 'ready':
      return changes > 0
        ? `There ${changes === 1 ? 'is' : 'are'} ${changes} local ${changes === 1 ? 'change' : 'changes'}. Safe sync protects tracked edits with Git autostash, integrates incoming commits, then restores the edits. Untracked files stay in place, and Git stops rather than overwriting a collision.`
        : 'Incoming commits are ready. Safe sync can integrate them into this branch now.';
    case 'integrating':
      return 'Git is protecting local edits and integrating the incoming commits. Keep this window open until the repository state is verified.';
    case 'conflicts':
      return 'Git paused because both sides changed the same content. Choose a version for each file, then continue; Abort restores the pre-sync state.';
    case 'complete':
      return changes > 0
        ? 'The branch is synchronized and your local edits are still present.'
        : 'The branch is synchronized and Git reports a clean working tree.';
    case 'aborted':
      return 'The integration was aborted. Git restored the pre-sync branch and reapplied the protected local edits.';
    case 'error':
      return error ? `Sync stopped safely: ${error}` : 'Sync stopped safely before Space could verify completion.';
  }
}

function remoteFromUpstream(upstream: string | null): { remoteName: string; branch?: string } {
  if (!upstream) return { remoteName: 'origin' };
  const slash = upstream.indexOf('/');
  if (slash === -1) return { remoteName: upstream };
  return { remoteName: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

export function GuidedSyncDialog({ open, onOpenChange, project, onChanged }: GuidedSyncDialogProps) {
  const [phase, setPhase] = useState<UiPhase>('idle');
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [guidance, setGuidance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guideRequest = useRef(0);

  async function guide(nextPhase: AiGitSyncPhase, nextStatus: GitStatusSummary, errorMessage?: string): Promise<void> {
    const request = guideRequest.current + 1;
    guideRequest.current = request;
    setGuidance(localGuidance(nextPhase, nextStatus, errorMessage));
    try {
      const key = await window.space.ai.keyStatus();
      if (!key.configured || !project) return;
      const result = await window.space.ai.guideGitSync({
        projectId: project.id,
        phase: nextPhase,
        branch: nextStatus.branch.branchName,
        hasUpstream: nextStatus.branch.upstream !== null,
        ahead: nextStatus.branch.ahead,
        behind: nextStatus.branch.behind,
        localChangeCount: localChangeCount(nextStatus),
        conflictCount: nextStatus.conflictedFiles.length,
        operationKind: nextStatus.operationState.kind,
        hasError: Boolean(errorMessage),
      });
      if (guideRequest.current === request) setGuidance(result.message);
    } catch {
      // Deterministic guidance remains visible when Gemini is unavailable.
    }
  }

  function setVerifiedPhase(nextStatus: GitStatusSummary, preferred?: AiGitSyncPhase): void {
    setStatus(nextStatus);
    if (nextStatus.conflictedFiles.length > 0 || nextStatus.operationState.kind !== 'none') {
      setPhase('conflicts');
      void guide('conflicts', nextStatus);
      return;
    }
    const nextPhase = preferred ?? ((nextStatus.branch.behind ?? 0) > 0 ? 'ready' : 'complete');
    setPhase(nextPhase);
    void guide(nextPhase, nextStatus);
  }

  async function inspectAndFetch(): Promise<void> {
    if (!project?.repositoryRoot) return;
    setBusy(true);
    setPhase('fetching');
    setError(null);
    setGuidance('Inspecting the working tree and fetching remote information…');
    try {
      const before = await window.space.git.status({ projectId: project.id });
      if (before.conflictedFiles.length > 0 || before.operationState.kind !== 'none') {
        setVerifiedPhase(before);
        return;
      }
      const remote = remoteFromUpstream(before.branch.upstream);
      await window.space.git.fetch({ projectId: project.id, remoteName: remote.remoteName });
      const after = await window.space.git.status({ projectId: project.id });
      if (after.branch.detached || after.branch.branchName === null) {
        const message = 'The project is not on a local branch. Switch to a branch before syncing.';
        setStatus(after);
        setError(message);
        setPhase('error');
        void guide('error', after, message);
        return;
      }
      if (after.branch.upstream === null) {
        const message = `Branch "${after.branch.branchName}" has no upstream branch yet. Publish it first so Space knows what to synchronize with.`;
        setStatus(after);
        setError(message);
        setPhase('error');
        void guide('error', after, message);
        return;
      }
      setVerifiedPhase(after);
      await onChanged?.();
    } catch (caught) {
      const message = toErrorMessage(caught);
      setError(message);
      const current = await window.space.git.status({ projectId: project.id }).catch(() => null);
      if (current) {
        setStatus(current);
        setPhase('error');
        void guide('error', current, message);
      } else {
        setPhase('error');
        setGuidance(`Sync stopped safely: ${message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) {
      guideRequest.current += 1;
      setPhase('idle');
      setStatus(null);
      setGuidance('');
      setError(null);
      return;
    }
    void inspectAndFetch();
    // A newly opened journey owns one immutable project selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  async function integrate(): Promise<void> {
    if (!project || !status) return;
    setBusy(true);
    setPhase('integrating');
    setError(null);
    void guide('integrating', status);
    const upstream = remoteFromUpstream(status.branch.upstream);
    try {
      await window.space.git.pull({
        projectId: project.id,
        mode: 'merge',
        remoteName: upstream.remoteName,
        ...(upstream.branch ? { branch: upstream.branch } : {}),
      });
      const after = await window.space.git.status({ projectId: project.id });
      setVerifiedPhase(after, 'complete');
      await onChanged?.();
    } catch (caught) {
      const message = toErrorMessage(caught);
      const after = await window.space.git.status({ projectId: project.id }).catch(() => null);
      if (after && (after.conflictedFiles.length > 0 || after.operationState.kind !== 'none')) {
        setError(message);
        setVerifiedPhase(after, 'conflicts');
      } else if (after) {
        setStatus(after);
        setError(message);
        setPhase('error');
        void guide('error', after, message);
      } else {
        setError(message);
        setPhase('error');
        setGuidance(`Sync stopped safely: ${message}`);
      }
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(path: string, side: 'ours' | 'theirs'): Promise<void> {
    if (!project) return;
    setBusy(true);
    try {
      await window.space.git.resolveConflict({ projectId: project.id, path, side });
      const after = await window.space.git.status({ projectId: project.id });
      setVerifiedPhase(after, after.conflictedFiles.length === 0 && after.operationState.kind === 'none' ? 'complete' : 'conflicts');
      await onChanged?.();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function continueSync(): Promise<void> {
    if (!project) return;
    setBusy(true);
    try {
      await window.space.git.continueConflict({ projectId: project.id });
      const after = await window.space.git.status({ projectId: project.id });
      setVerifiedPhase(after, 'complete');
      await onChanged?.();
    } catch (caught) {
      const message = toErrorMessage(caught);
      setError(message);
      const after = await window.space.git.status({ projectId: project.id }).catch(() => null);
      if (after) setVerifiedPhase(after, 'conflicts');
    } finally {
      setBusy(false);
    }
  }

  async function abortSync(): Promise<void> {
    if (!project || !status || status.operationState.kind === 'none') return;
    setBusy(true);
    try {
      await window.space.git.abortConflict({ projectId: project.id });
      const after = await window.space.git.status({ projectId: project.id });
      setStatus(after);
      setPhase('aborted');
      void guide('aborted', after);
      await onChanged?.();
    } catch (caught) {
      const message = toErrorMessage(caught);
      setError(message);
      setPhase('error');
      void guide('error', status, message);
    } finally {
      setBusy(false);
    }
  }

  const changes = status ? localChangeCount(status) : 0;
  const behind = status?.branch.behind ?? 0;
  const conflictIsIntegration = status?.operationState.kind !== 'none';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="Safe sync"
      {...(project ? { description: `${project.name} · ${status?.branch.branchName ?? 'current branch'}` } : {})}
      dismissible={!busy}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            {phase === 'complete' || phase === 'aborted' ? 'Done' : 'Close'}
          </Button>
          {phase === 'ready' && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void integrate()}>
              <ShieldCheck size={14} /> {changes > 0 ? 'Protect changes & sync' : 'Sync now'}
            </Button>
          )}
          {phase === 'conflicts' && status?.conflictedFiles.length === 0 && status.operationState.kind !== 'none' && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void continueSync()}>
              Continue sync
            </Button>
          )}
          {phase === 'error' && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void inspectAndFetch()}>
              Try again
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className={`rounded-md border p-2 ${phase !== 'idle' ? 'border-accent/40 bg-accent/5' : 'border-border'}`}>
            <CloudDownload size={14} className="mb-1 text-accent" /> 1. Fetch
          </div>
          <div className={`rounded-md border p-2 ${phase === 'ready' || phase === 'integrating' || phase === 'conflicts' || phase === 'complete' ? 'border-accent/40 bg-accent/5' : 'border-border'}`}>
            <ShieldCheck size={14} className="mb-1 text-accent" /> 2. Protect &amp; integrate
          </div>
          <div className={`rounded-md border p-2 ${phase === 'complete' ? 'border-success/40 bg-success/5' : 'border-border'}`}>
            <CheckCircle2 size={14} className="mb-1 text-success" /> 3. Verify
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-3">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
            {busy ? <Loader2 size={14} className="animate-spin text-accent" /> : <Bot size={14} className="text-accent" />}
            {busy ? 'Space is working' : 'AI guide'}
          </div>
          <p className="text-sm text-fg-muted">{guidance || 'Preparing the safe-sync journey…'}</p>
        </div>

        {status && (
          <div className="flex flex-wrap gap-1.5">
            <Badge>{status.branch.branchName ?? 'detached'}</Badge>
            <Badge>{status.branch.ahead ?? 0} ahead</Badge>
            <Badge>{behind} behind</Badge>
            <Badge>{changes} local {changes === 1 ? 'change' : 'changes'}</Badge>
          </div>
        )}

        {error && phase !== 'conflicts' && <InlineBanner variant="error">{error}</InlineBanner>}

        {phase === 'complete' && (
          <InlineBanner variant="success">
            <span className="flex items-center gap-2"><CheckCircle2 size={15} /> Sync verified. Local work was not discarded.</span>
          </InlineBanner>
        )}

        {phase === 'aborted' && (
          <InlineBanner variant="info">Sync was aborted and the pre-sync state was restored.</InlineBanner>
        )}

        {phase === 'conflicts' && status && (
          <div className="flex flex-col gap-2">
            {error && <InlineBanner variant="info">Git paused safely: {error}</InlineBanner>}
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-fg">
                {status.conflictedFiles.length > 0 ? `${status.conflictedFiles.length} conflicted ${status.conflictedFiles.length === 1 ? 'file' : 'files'}` : 'Conflicts resolved'}
              </p>
              {status.operationState.kind !== 'none' && (
                <Button variant="danger" size="sm" disabled={busy} onClick={() => void abortSync()}>
                  Abort &amp; restore
                </Button>
              )}
            </div>
            {status.conflictedFiles.map((file) => (
              <div key={file} className="rounded-md border border-danger/30 bg-danger/5 p-2.5">
                <div className="mb-2 flex items-center gap-2 text-sm text-fg">
                  <AlertTriangle size={14} className="shrink-0 text-danger" />
                  <span className="truncate" title={file}>{file}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void resolve(file, 'ours')}>
                    {conflictIsIntegration ? 'Keep my branch' : 'Keep synced version'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void resolve(file, 'theirs')}>
                    {conflictIsIntegration ? 'Use incoming' : 'Restore my local version'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
