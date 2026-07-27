import { LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { GithubAuthReport } from '@space/contracts';
import { Button, InlineBanner, StatusDot } from '@space/ui';

interface GithubAuthControlsProps {
  readonly report: GithubAuthReport | null;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
}

/** GitHub account status and actions. Interactive login is rendered only by GithubAuthDialog. */
export function GithubAuthControls({ report, busy, onRefresh, onSignIn, onSignOut }: GithubAuthControlsProps) {
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

      {!authenticated && (
        <InlineBanner variant="info">Sign in to GitHub above to use pull request and issue actions.</InlineBanner>
      )}
    </div>
  );
}
