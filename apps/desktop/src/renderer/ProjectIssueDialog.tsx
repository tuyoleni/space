import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { ProjectIssue, ProjectRemedy } from '@space/contracts';
import { Button, Dialog, Input, useToast } from '@space/ui';
import { toErrorMessage } from './errors';

/**
 * What the user sees instead of a failed command's stderr.
 *
 * Before this, clicking Push on a project with no remote produced
 * `fatal: 'origin' does not appear to be a git repository` in a red toast:
 * accurate, unactionable, and written for someone who already knows what a
 * remote is. This dialog states the problem in ordinary language and puts
 * the fixes on buttons, so the answer to "what do I do about it" is in the
 * same place as the question.
 *
 * Each remedy says exactly what it will do before it is chosen — a button
 * labelled "Create it on GitHub" that silently also uploads your code is
 * not obviously better than a cryptic error.
 */
interface ProjectIssueDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly issue: ProjectIssue | null;
  readonly projectId: string;
  /** Opens the app-owned GitHub CLI auth modal for interactive sign-in remedies. */
  readonly onGithubSignIn: () => void;
  /** Re-read project state after a remedy changes it. */
  readonly onResolved?: () => void | Promise<void>;
}

export function ProjectIssueDialog({ open, onOpenChange, issue, projectId, onGithubSignIn, onResolved }: ProjectIssueDialogProps) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // Only `add-existing-remote` needs input; it appears inline rather than as
  // a second dialog, so the explanation stays visible while typing.
  const [remoteUrl, setRemoteUrl] = useState('');
  const [expandedRemedyId, setExpandedRemedyId] = useState<string | null>(null);
  const { toast } = useToast();

  if (!issue) {
    return null;
  }

  async function apply(remedy: ProjectRemedy): Promise<void> {
    if (remedy.id === 'sign-in-to-github') {
      // This remedy is interactive. Route it through the renderer-owned auth
      // dialog so the PTY session always has a visible, contained home.
      onOpenChange(false);
      onGithubSignIn();
      return;
    }
    // A remedy that needs input reveals its field first rather than failing
    // on an empty value.
    if (remedy.id === 'add-existing-remote' && expandedRemedyId !== remedy.id) {
      setExpandedRemedyId(remedy.id);
      return;
    }
    setApplyingId(remedy.id);
    try {
      const result = await window.space.project.applyRemedy({
        projectId,
        remedyId: remedy.id,
        ...(remedy.id === 'add-existing-remote' ? { remoteUrl: remoteUrl.trim() } : {}),
      });
      toast({ variant: 'success', message: result.message });
      await onResolved?.();
      if (result.diagnosis.issues.every((next) => next.id !== issue?.id)) {
        onOpenChange(false);
      }
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setApplyingId(null);
    }
  }

  const busy = applyingId !== null;
  const Icon = issue.severity === 'blocking' ? AlertTriangle : Info;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={issue.title}
      footer={
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
          Not now
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2.5">
          <Icon size={16} className={issue.severity === 'blocking' ? 'mt-0.5 shrink-0 text-danger' : 'mt-0.5 shrink-0 text-fg-muted'} />
          <p className="text-sm text-fg-muted">{issue.detail}</p>
        </div>

        <div className="flex flex-col gap-2">
          {issue.remedies.map((remedy) => (
            <div
              key={remedy.id}
              className={
                remedy.recommended
                  ? 'rounded-md border border-accent/40 bg-accent/5 p-2.5'
                  : 'rounded-md border border-border p-2.5'
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{remedy.label}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{remedy.description}</p>
                </div>
                <Button
                  size="sm"
                  variant={remedy.recommended ? 'primary' : 'secondary'}
                  disabled={busy || (expandedRemedyId === remedy.id && remoteUrl.trim() === '')}
                  onClick={() => void apply(remedy)}
                >
                  {applyingId === remedy.id ? 'Working…' : remedy.automatic ? 'Do it' : 'Continue'}
                </Button>
              </div>

              {expandedRemedyId === remedy.id && remedy.id === 'add-existing-remote' && (
                <label className="mt-2 flex flex-col gap-1.5 text-xs text-fg-muted">
                  Repository address
                  <Input
                    autoFocus
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && remoteUrl.trim() !== '' && void apply(remedy)}
                    placeholder="git@github.com:you/your-repo.git"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
