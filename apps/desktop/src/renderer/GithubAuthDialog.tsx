import type { GithubAuthReport, TerminalSessionInfo } from '@space/contracts';
import { CheckCircle2, Loader2, TerminalSquare } from 'lucide-react';
import { Button, Dialog } from '@space/ui';
import { TerminalPanel } from './TerminalPanel';

interface GithubAuthDialogProps {
  readonly open: boolean;
  readonly report: GithubAuthReport | null;
  readonly session: TerminalSessionInfo | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onRefresh: () => void | Promise<void>;
}

/** The only renderer surface allowed to host the interactive `gh auth login` PTY. */
export function GithubAuthDialog({ open, report, session, busy, onClose, onRefresh }: GithubAuthDialogProps) {
  const authenticated = report?.authenticated ?? false;

  function finish(): void {
    onClose();
    void Promise.resolve(onRefresh()).catch(() => undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && finish()}
      title="Sign in to GitHub"
      description="Complete the secure GitHub sign-in here. This prompt stays in this dialog."
      size="lg"
      footer={
        <Button size="sm" variant={authenticated ? 'primary' : 'secondary'} onClick={finish}>
          {authenticated ? <CheckCircle2 size={13} /> : null} {authenticated ? 'Done' : 'I’ve finished — check status'}
        </Button>
      }
    >
      {session ? (
        <div className="overflow-hidden rounded-lg border border-border bg-app-bg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-fg-muted">
            <TerminalSquare size={13} /> GitHub CLI is waiting for your response
          </div>
          <div className="h-56">
            <TerminalPanel session={session} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-2.5 text-sm text-fg-muted" role="status" aria-live="polite">
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin text-accent" /> Starting secure GitHub sign-in…
            </>
          ) : (
            'GitHub sign-in could not be started. Close this dialog and try again.'
          )}
        </div>
      )}
    </Dialog>
  );
}
