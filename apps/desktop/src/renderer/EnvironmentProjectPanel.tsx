import { useCallback, useEffect, useState } from 'react';
import type { JsPackageManagerId, ProjectEnvironmentInfo } from '@space/contracts';
import { ChevronDown, ChevronRight, Cpu, FileKey2, Package, Play, ScrollText } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardRows, CardTitle, Dialog, Input, useToast } from '@space/ui';

interface EnvironmentProjectPanelProps {
  readonly projectId: string | null;
  readonly onRunScript?: (scriptName: string) => void;
}

/**
 * "Project Environment" card: the real runtime/package-manager/lockfile/
 * scripts/env-var summary for the currently selected project, fetched
 * independently on `projectId` change (mirrors HomeView's Dependencies
 * card's own per-project fetch, not a value threaded down from a parent
 * scan). The card is deliberately read-only except for its real script
 * actions: settings that cannot be changed here are presented as facts,
 * not as disabled controls.
 */
export function EnvironmentProjectPanel({ projectId, onRunScript }: EnvironmentProjectPanelProps) {
  const { toast } = useToast();
  const [info, setInfo] = useState<ProjectEnvironmentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptsExpanded, setScriptsExpanded] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState('');
  const [packageManagerOpen, setPackageManagerOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setInfo(await window.space.project.environmentInfo({ projectId }));
  }, [projectId]);

  useEffect(() => {
    setInfo(null);
    setError(null);
    setScriptsExpanded(false);
    if (!projectId) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    void window.space.project
      .environmentInfo({ projectId })
      .then((result) => {
        if (!cancelled) {
          setInfo(result);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function saveRuntime(): Promise<void> {
    if (!projectId || !runtimeVersion.trim()) return;
    setBusy(true);
    try {
      const result = await window.space.project.setEnvironmentRuntime({ projectId, version: runtimeVersion.trim() });
      await refresh();
      setRuntimeOpen(false);
      toast({ variant: 'success', message: `Node runtime pinned in ${result.filePath}.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function changePackageManager(packageManager: JsPackageManagerId): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    try {
      const result = await window.space.project.installDependencies({ projectId, packageManager, allowOnce: true });
      if (!result.succeeded) throw new Error(`${packageManager} exited with code ${result.exitCode ?? 'unknown'}.`);
      await refresh();
      setPackageManagerOpen(false);
      toast({ variant: 'success', message: `Dependencies installed with ${packageManager}; its lockfile is now available to Space.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function manageEnvironmentFile(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    try {
      const result = await window.space.project.openEnvironmentFile({ projectId });
      await refresh();
      toast({ variant: 'success', message: `Opened ${result.filePath}.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project Environment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-faint">Select a project to see its environment.</p>
        </CardContent>
      </Card>
    );
  }

  const environmentReady = Boolean(info?.runtimeVersion && info.packageManager && info.lockfileDetected);

  return (
    <>
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0">
          <CardTitle>Project environment</CardTitle>
          <p className="mt-0.5 text-[11px] leading-4 text-fg-faint">Detected from this project</p>
        </div>
        {info && (
          <Badge variant={environmentReady ? 'success' : 'warning'}>
            {environmentReady ? 'Ready' : 'Needs setup'}
          </Badge>
        )}
      </CardHeader>
      {error ? (
        <CardContent>
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      ) : !info ? (
        <CardContent>
          <p className="text-sm text-fg-faint">{busy ? 'Loading…' : ''}</p>
        </CardContent>
      ) : (
        <CardRows>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                <Cpu size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg">Runtime</span>
                <span className="block truncate text-[11px] text-fg-faint">
                  {info.runtimeSource ? `Provided by ${info.runtimeSource}` : 'No source detected'}
                </span>
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-sm font-medium text-fg">{info.runtimeVersion ?? 'Not found'}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                setRuntimeVersion((info.runtimeVersion ?? '').replace(/^v/, ''));
                setRuntimeOpen(true);
              }}>Switch</Button>
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                <Package size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg">Packages</span>
                <span className="block truncate text-[11px] text-fg-faint" title={info.lockfileName ?? undefined}>
                  {info.lockfileDetected ? info.lockfileName : 'No lockfile detected'}
                </span>
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-sm font-medium text-fg">{info.packageManager ?? 'Not found'}</span>
              <span
                aria-label={info.lockfileDetected ? 'Lockfile detected' : 'Lockfile missing'}
                className={`size-1.5 rounded-full ${info.lockfileDetected ? 'bg-success' : 'bg-fg-faint'}`}
              />
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPackageManagerOpen(true)}>Change</Button>
            </span>
          </div>

          <div className="flex flex-col py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                  <ScrollText size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-fg">Scripts</span>
                  <span className="block text-[11px] text-fg-faint">
                    {info.scriptNames.length === 0 ? 'No commands found' : `${info.scriptNames.length} commands available`}
                  </span>
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={scriptsExpanded}
                onClick={() => setScriptsExpanded((expanded) => !expanded)}
                disabled={info.scriptNames.length === 0}
              >
                {scriptsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {scriptsExpanded ? 'Hide' : 'View'}
              </Button>
            </div>
            {scriptsExpanded && info.scriptNames.length > 0 && (
              <div className="mt-2 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-hover/40">
                {info.scriptNames.map((scriptName) => (
                  <button
                    key={scriptName}
                    type="button"
                    disabled={!onRunScript}
                    onClick={() => onRunScript?.(scriptName)}
                    className="flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-xs text-fg hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
                    title={onRunScript ? `Run ${info.packageManager ?? 'npm'} run ${scriptName}` : undefined}
                  >
                    <span className="truncate">{scriptName}</span>
                    {onRunScript && <Play size={12} className="shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                <FileKey2 size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg">Environment file</span>
                <span className="block truncate text-[11px] text-fg-faint" title={info.envFileName ?? undefined}>
                  {info.envFileName ?? 'No .env file detected'}
                </span>
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {info.envFileName && (
                <span className="text-xs text-fg-muted">
                  {info.envVariableNames.length} {info.envVariableNames.length === 1 ? 'variable' : 'variables'}
                </span>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void manageEnvironmentFile()}>Manage</Button>
            </span>
          </div>
        </CardRows>
      )}
    </Card>

    <Dialog
      open={runtimeOpen}
      onOpenChange={setRuntimeOpen}
      title="Switch Node runtime"
      description="Space will pin this project by writing .nvmrc. New terminals and supported version managers will use it."
      footer={<>
        <Button size="sm" variant="ghost" onClick={() => setRuntimeOpen(false)}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={busy || !runtimeVersion.trim()} onClick={() => void saveRuntime()}>Save runtime</Button>
      </>}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
        Node version
        <Input value={runtimeVersion} placeholder="24 or 24.4.1" onChange={(event) => setRuntimeVersion(event.target.value)} />
      </label>
    </Dialog>

    <Dialog
      open={packageManagerOpen}
      onOpenChange={setPackageManagerOpen}
      title="Change package manager"
      description="Space will run the selected package manager's install command in this project. It will create or update that manager's real lockfile."
    >
      <div className="grid grid-cols-3 gap-2">
        {(['npm', 'pnpm', 'yarn'] as const).map((manager) => (
          <Button key={manager} variant={manager === info?.packageManager ? 'primary' : 'secondary'} disabled={busy} onClick={() => void changePackageManager(manager)}>
            {manager}
          </Button>
        ))}
      </div>
    </Dialog>
    </>
  );
}
