import { useCallback, useEffect, useState } from 'react';
import type { GithubAuthReport, TerminalSessionInfo } from '@space/contracts';
import { useToast } from '@space/ui';
import { friendlyGithubErrorMessage } from './errors';

/**
 * Auth status + sign in/out for a workspace's `gh` session, shared by every
 * screen that surfaces GitHub auth (the app header and the per-project
 * GitHub tab) so there's exactly one place that knows how to start/track the
 * interactive `gh auth login` PTY.
 */
export function useGithubAuth(workspaceId: string) {
  const [report, setReport] = useState<GithubAuthReport | null>(null);
  const [loginSession, setLoginSession] = useState<TerminalSessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  // workspaceId is '' before a workspace has loaded (e.g. AppShell's initial
  // render) — there's nothing to report on yet, so skip the call rather than
  // asking the main process to look up an empty workspace id.
  const refreshReport = useCallback(async () => {
    if (!workspaceId) {
      setReport(null);
      return;
    }
    setReport(await window.space.github.authReport({ workspaceId }));
  }, [workspaceId]);

  useEffect(() => {
    void refreshReport();
  }, [refreshReport]);

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

  function signIn(): void {
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

  function signOut(): void {
    void guarded(async () => {
      await window.space.github.authLogout({ workspaceId });
      setLoginSession(null);
      await refreshReport();
    });
  }

  /** Dismiss the login PTY view (e.g. closing its dialog) without ending the underlying `gh auth login` session — the user can reopen it via signIn's returned session id, or just re-check status with refreshReport. */
  function dismissLogin(): void {
    setLoginSession(null);
  }

  return { report, loginSession, busy, refreshReport, signIn, signOut, dismissLogin, guarded };
}
