import { LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { GithubAuthReport, TerminalSessionInfo } from '@space/contracts';
import { Button, InlineBanner, StatusDot } from '@space/ui';
import { TerminalPanel } from './TerminalPanel';

interface GithubAuthControlsProps {
  readonly report: GithubAuthReport | null;
  readonly loginSession: TerminalSessionInfo | null;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
}

/**
 * Sign-in status, sign in/out, and the interactive `gh auth login` PTY. The
 * PTY reuses TerminalPanel verbatim: the session it renders was created
 * through the exact same PTY host and `terminal:*` IPC channels a regular
 * shell uses (spec 14.3), so no second terminal-rendering implementation is
 * needed here.
 */
export function GithubAuthControls({ report, loginSession, busy, onRefresh, onSignIn, onSignOut }: GithubAuthControlsProps) {
  const authenticated = report?.authenticated ?? false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={13} /> Refresh auth status
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onSignIn}>
          <LogIn size={13} /> Sign in&hellip;
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !authenticated} onClick={onSignOut}>
          <LogOut size={13} /> Sign out
        </Button>
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <span className="text-fg-muted">CLI installed</span>
          <span className="text-fg">{report.cliInstalled ? `Yes (${report.cliVersion ?? 'unknown version'})` : 'No'}</span>
          <span className="text-fg-muted">Authenticated</span>
          <span className="flex items-center gap-1.5 text-fg">
            <StatusDot tone={authenticated ? 'success' : 'neutral'} />
            {authenticated ? 'Yes' : 'No'}
            {report.activeAccount && ` as ${report.activeAccount.account} on ${report.activeAccount.host}`}
          </span>
          <span className="text-fg-muted">Git protocol</span>
          <span className="text-fg">{report.gitProtocol ?? 'unknown'}</span>
          <span className="text-fg-muted">Token source</span>
          <span className="text-fg">{report.tokenSourceStrategy}</span>
        </div>
      )}

      {loginSession && (
        <div>
          <p className="mb-1.5 text-xs text-fg-muted">Follow the instructions below to finish signing in, then refresh auth status.</p>
          <div className="overflow-hidden rounded-md border border-border">
            <TerminalPanel session={loginSession} />
          </div>
        </div>
      )}

      {!authenticated && (
        <InlineBanner variant="info">Sign in to GitHub above to use pull request and issue actions.</InlineBanner>
      )}
    </div>
  );
}
