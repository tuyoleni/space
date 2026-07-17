import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { BootstrapStatusResult, BootstrapStepSummary } from '@space/contracts';
import { Button, Input, StatusDot, useToast } from '@space/ui';
import { toErrorMessage } from './errors';

interface OnboardingWizardProps {
  readonly onCreateWorkspace: (name: string) => void;
  readonly onDismiss: () => void;
}

type WizardStage = 'loading' | 'welcome' | 'toolchain' | 'workspace';

const ACTIVE_STATUSES = new Set<BootstrapStatusResult['status']>(['plan_ready', 'installing']);

/**
 * First-run wizard for a brand-new install (spec section 8, ONB-001..008):
 * checks the required toolchain (git/gh/volta/node/npm) via the real
 * bootstrap backend — window.space.bootstrap.* — and offers a one-click
 * install for whatever's missing, before handing off to creating the
 * first workspace. Shown by AppShell whenever there are zero workspaces;
 * every stage has a "Skip" escape hatch, since none of this is required
 * to use the app — a user who already has their toolchain set up
 * shouldn't be blocked by it.
 */
export function OnboardingWizard({ onCreateWorkspace, onDismiss }: OnboardingWizardProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<BootstrapStatusResult | null>(null);
  const [stage, setStage] = useState<WizardStage>('loading');
  const [busy, setBusy] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');

  useEffect(() => {
    void window.space.bootstrap
      .getStatus()
      .then((result) => {
        setStatus(result);
        setStage(result.resumeAction === 'start_fresh' ? 'welcome' : result.resumeAction === 'show_complete' ? 'workspace' : 'toolchain');
      })
      .catch((caught) => {
        toast({ variant: 'error', message: toErrorMessage(caught) });
        setStage('welcome');
      });
    // One real read on mount — every stage transition afterward is driven by explicit user actions, not a background poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScan(): Promise<void> {
    setBusy(true);
    try {
      setStatus(await window.space.bootstrap.buildPlan());
      setStage('toolchain');
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function runAllSteps(): Promise<void> {
    setBusy(true);
    try {
      let result = await window.space.bootstrap.runNextStep();
      setStatus(result);
      while (result.nextStepIndex !== null && ACTIVE_STATUSES.has(result.status)) {
        // eslint-disable-next-line no-await-in-loop -- steps must run one at a time, in order, never race.
        result = await window.space.bootstrap.runNextStep();
        setStatus(result);
      }
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function retryToolchain(): Promise<void> {
    setBusy(true);
    try {
      setStatus(await window.space.bootstrap.buildPlan());
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  function handleCreateWorkspace(): void {
    const name = workspaceName.trim();
    if (!name) {
      return;
    }
    onCreateWorkspace(name);
    onDismiss();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-full max-w-lg max-h-[85vh] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Sparkles size={15} className="text-accent" /> Welcome to Space
          </span>
          <button type="button" aria-label="Skip setup" onClick={onDismiss} className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          {stage === 'loading' && <p className="text-sm text-fg-muted">Checking your machine&hellip;</p>}

          {stage === 'welcome' && (
            <>
              <p className="text-sm text-fg-muted">
                Space can check this machine for the tools most projects need — Git, GitHub CLI, and a JavaScript runtime — and install
                whatever's missing. Nothing runs without your say-so.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => void startScan()} disabled={busy}>
                  {busy ? 'Checking…' : 'Check my machine'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStage('workspace')} disabled={busy}>
                  Skip this
                </Button>
              </div>
            </>
          )}

          {stage === 'toolchain' && status && (
            <>
              {status.blockReason && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  <span className="text-fg">{status.blockReason}</span>
                </div>
              )}

              {status.steps.length === 0 ? (
                <p className="text-sm text-fg-muted">Nothing to install — your machine already has everything Space needs.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {status.steps.map((step, index) => (
                    <StepRow key={`${step.toolId ?? step.displayName}-${index}`} step={step} />
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2">
                {status.nextStepIndex !== null ? (
                  <Button variant="primary" size="sm" onClick={() => void runAllSteps()} disabled={busy}>
                    {busy ? 'Installing…' : 'Install missing tools'}
                  </Button>
                ) : status.status === 'blocked' ? (
                  <Button variant="secondary" size="sm" onClick={() => void retryToolchain()} disabled={busy}>
                    Retry
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setStage('workspace')} disabled={busy}>
                    Continue <ArrowRight size={13} />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setStage('workspace')} disabled={busy}>
                  Skip this
                </Button>
              </div>
            </>
          )}

          {stage === 'workspace' && (
            <>
              <p className="text-sm text-fg-muted">Name your first workspace — you can add projects to it right after.</p>
              <Input
                autoFocus
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleCreateWorkspace();
                  }
                }}
                placeholder="My Workspace"
                aria-label="Workspace name"
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleCreateWorkspace} disabled={!workspaceName.trim()}>
                  Create workspace
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                  I'll do this later
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step }: { readonly step: BootstrapStepSummary }) {
  const { icon, tone } = stepVisual(step.state);
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm">
      {icon ?? <StatusDot tone={tone} />}
      <span className="flex-1 text-fg">{step.displayName}</span>
      <span className="text-xs text-fg-faint">{stepStateLabel(step.state)}</span>
    </li>
  );
}

function stepVisual(state: BootstrapStepSummary['state']): { readonly icon: JSX.Element | null; readonly tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (state) {
    case 'successful':
    case 'skipped':
      return { icon: <Check size={14} className="text-success" />, tone: 'success' };
    case 'failed':
      return { icon: null, tone: 'danger' };
    case 'needs_restart':
      return { icon: null, tone: 'warning' };
    case 'running':
      return { icon: <Loader2 size={14} className="animate-spin text-accent" />, tone: 'neutral' };
    case 'cancelled':
    case 'pending':
    default:
      return { icon: null, tone: 'neutral' };
  }
}

function stepStateLabel(state: BootstrapStepSummary['state']): string {
  switch (state) {
    case 'successful':
      return 'Installed';
    case 'skipped':
      return 'Already present';
    case 'failed':
      return 'Failed';
    case 'needs_restart':
      return 'Needs restart';
    case 'running':
      return 'Installing…';
    case 'cancelled':
      return 'Cancelled';
    case 'pending':
    default:
      return 'Pending';
  }
}
