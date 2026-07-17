import { useState } from 'react';
import { CheckCircle2, ExternalLink, X } from 'lucide-react';
import { siGithub } from 'simple-icons';
import type { Project } from '@space/contracts';
import { Button, useToast } from '@space/ui';
import { BrandIcon } from './brand-icons';
import { useGithubAuth } from './useGithubAuth';
import { TerminalPanel } from './TerminalPanel';
import { friendlyGithubErrorMessage } from './errors';

interface GithubSetupPromptProps {
  readonly project: Project;
  readonly workspaceId: string;
  readonly onDismiss: () => void;
}

type Stage = 'confirm' | 'signing-in' | 'working' | 'done';

/**
 * Shown automatically right after importing a project that isn't tracked
 * by Git yet: offers to initialize it, create a matching repository under
 * the user's GitHub account (via the real `gh` CLI — see github-engine's
 * `createAndPublishRepository`), and push — or, if a repo with that name
 * already exists, just connect it as the remote rather than overwriting
 * anything (github-handlers.ts's publishRepository never force-overwrites
 * a name collision). Reuses useGithubAuth's exact sign-in PTY flow so
 * there's still exactly one place that knows how to drive `gh auth login`.
 */
export function GithubSetupPrompt({ project, workspaceId, onDismiss }: GithubSetupPromptProps) {
  const { toast } = useToast();
  const auth = useGithubAuth(workspaceId);
  const [stage, setStage] = useState<Stage>('confirm');
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  async function publish(): Promise<void> {
    setStage('working');
    try {
      const owner = auth.report?.activeAccount?.account;
      if (!owner) {
        throw new Error('Signed in, but no active GitHub account could be determined.');
      }
      const initialized = await window.space.git.initRepo({ projectId: project.id });
      if (!initialized.repositoryRoot) {
        throw new Error(`"${project.name}" could not be initialized as a Git repository.`);
      }
      const plan = await window.space.github.repoPlanPublish({ workspaceId, owner, name: project.name });
      const result =
        plan.kind === 'conflict'
          ? await window.space.github.repoPublish({
              projectId: project.id,
              owner,
              name: project.name,
              visibility: 'private',
              sourceFolder: initialized.repositoryRoot,
              push: true,
              connect: { nameWithOwner: plan.existing.nameWithOwner, url: plan.existing.url },
            })
          : await window.space.github.repoPublish({
              projectId: project.id,
              owner,
              name: project.name,
              visibility: 'private',
              sourceFolder: initialized.repositoryRoot,
              push: true,
            });
      setResultUrl(result.url);
      setStage('done');
      toast({
        variant: 'success',
        message: plan.kind === 'conflict' ? `Connected "${project.name}" to the existing ${result.nameWithOwner}.` : `Published "${project.name}" to ${result.nameWithOwner}.`,
      });
    } catch (caught) {
      toast({ variant: 'error', message: friendlyGithubErrorMessage(caught) });
      onDismiss();
    }
  }

  function handleAccept(): void {
    if (!auth.report?.authenticated) {
      setStage('signing-in');
      auth.signIn();
      return;
    }
    void publish();
  }

  async function handleSignedIn(): Promise<void> {
    await auth.refreshReport();
    auth.dismissLogin();
    void publish();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-full max-w-lg max-h-[85vh] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <BrandIcon icon={siGithub} size={15} monochrome /> Set up GitHub for "{project.name}"
          </span>
          {stage !== 'working' && (
            <button type="button" aria-label="Not now" onClick={onDismiss} className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          {stage === 'confirm' && (
            <>
              <p className="text-sm text-fg-muted">
                "{project.name}" isn't tracked by Git yet. Space can set it up in one step: initialize a repository, create{' '}
                <span className="text-fg">{project.name}</span> as a private repo on your GitHub account (or connect it if one already exists), and
                push your code — real backup, PR/issue tracking, and everything else in the GitHub tab, without touching a terminal.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleAccept}>
                  Set up GitHub
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  Not now
                </Button>
              </div>
            </>
          )}

          {stage === 'signing-in' && (
            <>
              <p className="text-sm text-fg-muted">Sign in to GitHub, then continue.</p>
              {auth.loginSession && (
                <div className="overflow-hidden rounded-md border border-border">
                  <TerminalPanel session={auth.loginSession} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => void handleSignedIn()} disabled={auth.busy}>
                  I've signed in — Continue
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  Not now
                </Button>
              </div>
            </>
          )}

          {stage === 'working' && <p className="text-sm text-fg-muted">Setting up GitHub for "{project.name}"&hellip;</p>}

          {stage === 'done' && (
            <>
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 size={15} /> Done.
              </div>
              <div className="flex items-center gap-2">
                {resultUrl && (
                  <Button variant="secondary" size="sm" onClick={() => window.open(resultUrl, '_blank')}>
                    <ExternalLink size={13} /> Open on GitHub
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
