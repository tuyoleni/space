import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, GitBranch, Loader2, TerminalSquare, TriangleAlert, Wrench } from 'lucide-react';
import type { AiToolsStatus, BootstrapStatusResult, BootstrapStepSummary } from '@space/contracts';
import { Button, StatusDot, useToast } from '@space/ui';
import { toErrorMessage } from './errors';

type WizardStage = 'loading' | 'welcome' | 'review' | 'mcp' | 'ready';
const ACTIVE_STATUSES = new Set<BootstrapStatusResult['status']>(['plan_ready', 'installing']);

/**
 * The first window a new Space install sees. It deliberately has no dismiss,
 * skip, or close-to-main-app path: the main window opens only after the
 * persisted bootstrap run is complete.
 */
export function OnboardingWizard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<BootstrapStatusResult | null>(null);
  const [stage, setStage] = useState<WizardStage>('loading');
  const [busy, setBusy] = useState(false);
  const [aiTools, setAiTools] = useState<AiToolsStatus | null>(null);

  async function refreshAiTools(): Promise<AiToolsStatus> {
    const result = await window.space.aiTools.status();
    setAiTools(result);
    return result;
  }

  useEffect(() => {
    void window.space.bootstrap.getStatus().then((result) => {
      setStatus(result);
      if (result.status === 'complete') {
        void refreshAiTools().then(() => setStage('mcp'), () => setStage('mcp'));
      } else {
        setStage(result.resumeAction === 'start_fresh' ? 'welcome' : 'review');
      }
    }, (caught) => {
      toast({ variant: 'error', message: toErrorMessage(caught) });
      setStage('welcome');
    });
  }, [toast]);

  async function scanMachine(): Promise<void> {
    setBusy(true);
    try {
      setStatus(await window.space.bootstrap.buildPlan());
      setStage('review');
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function installRequiredTools(): Promise<void> {
    setBusy(true);
    try {
      let result = await window.space.bootstrap.runNextStep();
      setStatus(result);
      while (result.nextStepIndex !== null && ACTIVE_STATUSES.has(result.status)) {
        // Installers are ordered and need a fresh verification after each one.
        // eslint-disable-next-line no-await-in-loop
        result = await window.space.bootstrap.runNextStep();
        setStatus(result);
      }
      if (result.status === 'complete') {
        await refreshAiTools();
        setStage('mcp');
      }
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function openSpace(): Promise<void> {
    setBusy(true);
    try {
      await window.space.bootstrap.complete();
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
      setBusy(false);
    }
  }

  async function connectCodex(): Promise<void> {
    setBusy(true);
    try {
      await window.space.aiTools.connect({ tool: 'codex' });
      await refreshAiTools();
      setStage('ready');
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const codex = aiTools?.tools.find((tool) => tool.id === 'codex') ?? null;

  return (
    <main className="flex min-h-screen flex-col bg-app-bg text-fg">
      <section className="mx-auto flex min-h-screen w-full max-w-xl flex-col">
        <div className="flex flex-1 flex-col justify-center px-6 py-5">
          {stage === 'loading' && <div className="flex items-center gap-3 text-fg-muted"><Loader2 className="animate-spin" /> Checking saved setup progress…</div>}

          {stage === 'welcome' && (
            <div className="max-w-xl">
              <p className="text-xl font-semibold tracking-tight">Prepare this Mac for project work</p>
              <p className="mt-2 text-sm leading-6 text-fg-muted">We’ll check the tools below and show anything missing before it installs.</p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <ToolPreview icon={<GitBranch />} title="Git" detail="Source control" />
                <ToolPreview icon={<GitBranch />} title="GitHub CLI" detail="Repository access" />
                <ToolPreview icon={<TerminalSquare />} title="JavaScript runtime" detail="Node and package tools" />
              </div>
              <Button className="mt-5" size="sm" variant="primary" onClick={() => void scanMachine()} disabled={busy}>{busy ? 'Checking…' : 'Check this Mac'} <ArrowRight size={14} /></Button>
            </div>
          )}

          {stage === 'review' && status && (
            <div className="w-full">
              <p className="text-lg font-semibold">Review required setup</p>
              <p className="mt-2 text-sm text-fg-muted">Space will only run the items listed below. Each is verified before setup can continue.</p>
              {status.blockReason && <div className="mt-6 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4"><TriangleAlert className="mt-0.5 text-danger" size={18} /><span className="text-sm">{status.blockReason}</span></div>}
              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                {status.steps.length === 0 ? <div className="p-4 text-sm text-fg-muted">Everything required is already installed. Space will record verification before continuing.</div> : status.steps.map((step, index) => <StepRow key={`${step.toolId ?? step.displayName}-${index}`} step={step} />)}
              </div>
              <div className="mt-4 flex items-center gap-3">
                {status.status === 'blocked' || status.status === 'partially_complete' ? (
                  <Button variant="primary" onClick={() => void scanMachine()} disabled={busy}>Check this Mac again <ArrowRight size={15} /></Button>
                ) : (
                  <Button variant="primary" onClick={() => void installRequiredTools()} disabled={busy}>{busy ? 'Installing and verifying…' : status.steps.length === 0 ? 'Verify setup' : 'Install required tools'} <Wrench size={15} /></Button>
                )}
              </div>
            </div>
          )}

          {stage === 'mcp' && (
            <div className="max-w-xl">
              <p className="text-xl font-semibold tracking-tight">Connect Codex</p>
              <p className="mt-2 text-sm leading-6 text-fg-muted">Let Codex read Space’s local workspace and Git context instead of working from a blind folder.</p>
              <div className="mt-5 rounded-lg border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Codex</span><span className="text-xs text-fg-muted">{codex?.connected ? 'Connected' : 'Ready to connect'}</span></div>
                <p className="mt-1 text-xs text-fg-muted">Space stays local to this Mac and only exposes read-only workspace tools.</p>
              </div>
              <div className="mt-4 flex items-center gap-3">
                {codex?.connected ? (
                  <Button size="sm" variant="primary" onClick={() => setStage('ready')}>Continue <ArrowRight size={14} /></Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => void connectCodex()} disabled={busy || !codex}>{busy ? 'Connecting…' : 'Connect Codex'} <ArrowRight size={14} /></Button>
                )}
              </div>
            </div>
          )}

          {stage === 'ready' && <div className="max-w-xl text-center"><CheckCircle2 className="mx-auto text-success" size={36} /><p className="mt-3 text-xl font-semibold">Your development tools are ready.</p><p className="mt-2 text-sm text-fg-muted">Space has finished required setup.</p><Button className="mt-5" size="sm" variant="primary" onClick={() => void openSpace()} disabled={busy}>Open Space <ArrowRight size={14} /></Button></div>}
        </div>
      </section>
    </main>
  );
}

function ToolPreview({ icon, title, detail }: { readonly icon: JSX.Element; readonly title: string; readonly detail: string }) {
  return <div className="rounded-lg border border-border bg-surface-raised p-3"><span className="text-accent">{icon}</span><p className="mt-2 text-xs font-medium">{title}</p><p className="mt-0.5 text-[10px] text-fg-muted">{detail}</p></div>;
}

function StepRow({ step }: { readonly step: BootstrapStepSummary }) {
  const active = step.state === 'running';
  return <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"><StatusDot tone={step.state === 'successful' || step.state === 'skipped' ? 'success' : step.state === 'failed' ? 'danger' : 'neutral'} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{step.displayName}</p><p className="mt-0.5 text-xs text-fg-muted">{step.humanExplanation}</p></div><span className="text-xs text-fg-muted">{active ? 'Installing…' : step.state === 'successful' ? 'Installed' : step.state === 'skipped' ? 'Already present' : step.state === 'failed' ? 'Failed' : 'Required'}</span></div>;
}
