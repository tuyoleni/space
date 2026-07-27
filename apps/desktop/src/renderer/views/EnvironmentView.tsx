import { useEffect, useState } from 'react';
import { DownloadCloud, Download, Laptop2, Package, RefreshCw, Terminal, Zap } from 'lucide-react';
import type { EnvironmentScanResult, EnvironmentScanToolResult, GithubAuthReport } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, StatusDot, useToast } from '@space/ui';
import { AiToolsPanel } from '../AiToolsPanel';
import { BrandIcon, TOOL_BRAND } from '../brand-icons';
import { EnvironmentProjectPanel } from '../EnvironmentProjectPanel';
import { EnvironmentServicesPanel } from '../EnvironmentServicesPanel';
import { EnvironmentSuggestedActions } from '../EnvironmentSuggestedActions';
import { PackagesPanel } from '../PackagesPanel';
import { PackageUpdatesMenu } from '../PackageUpdatesMenu';

/** Real brand icon for a toolchain entry, with a lucide fallback for the few (e.g. Volta) that have no Simple Icon. */
function ToolIcon({ toolId }: { readonly toolId: string }) {
  const brand = TOOL_BRAND[toolId];
  if (brand) {
    return <BrandIcon icon={brand} size={14} />;
  }
  if (toolId === 'volta') {
    return <Zap size={14} className="text-accent" />;
  }
  return <Package size={14} className="text-fg-muted" />;
}

/** Small stat tile — mirrors the compact icon + label + value pattern used elsewhere (e.g. SystemView's CPU/Memory tiles). */
function StatTile({
  icon,
  label,
  value,
  secondary,
}: {
  readonly icon: JSX.Element;
  readonly label: string;
  readonly value: string;
  readonly secondary?: string | null | undefined;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2.5 py-2.5">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-hover">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-fg-muted">{label}</p>
          <p className="truncate text-sm font-semibold text-fg">{value}</p>
          {secondary && <p className="truncate text-[11px] text-fg-faint">{secondary}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function toolStatus(tool: EnvironmentScanToolResult): { tone: 'success' | 'warning' | 'neutral'; label: string } {
  if (!tool.found) {
    return { tone: 'neutral', label: 'Not found' };
  }
  if (tool.meetsMinimumVersion === false) {
    return { tone: 'warning', label: 'Below minimum' };
  }
  return { tone: 'success', label: 'Installed' };
}

interface EnvironmentViewProps {
  readonly selectedProjectId: string | null;
  readonly activeWorkspaceId: string | null;
  readonly githubReport: GithubAuthReport | null;
  readonly onRunScript?: (scriptName: string) => void;
}

export function EnvironmentView({ selectedProjectId, activeWorkspaceId, githubReport, onRunScript }: EnvironmentViewProps) {
  const { toast } = useToast();
  const [scan, setScan] = useState<EnvironmentScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFlightToolIds, setInFlightToolIds] = useState<ReadonlySet<string>>(new Set());

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      setScan(await window.space.environment.scan({}));
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one real scan on mount; Rescan re-triggers explicitly.
  }, []);

  async function exportReport(): Promise<void> {
    if (!scan || busy) {
      return;
    }
    setBusy(true);
    try {
      await window.space.environment.exportReport({ scan });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  const missingTools = scan?.tools.filter((tool) => tool.found === false) ?? [];

  async function installMissing(): Promise<void> {
    if (busy || missingTools.length === 0) {
      return;
    }
    setBusy(true);
    try {
      for (const tool of missingTools) {
        const activityId = `tool:${tool.toolId}:${Date.now()}`;
        window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label: `Installing ${tool.displayName}`, state: 'running' } }));
        // eslint-disable-next-line no-await-in-loop -- installs must run one at a time, never race.
        try {
          await window.space.environment.installTool({ toolId: tool.toolId });
          window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label: `Installing ${tool.displayName}`, state: 'completed' } }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label: `Installing ${tool.displayName}`, state: 'failed', message: error instanceof Error ? error.message : String(error) } }));
          throw error;
        }
      }
      await refresh();
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function runToolAction(toolId: string, action: 'install' | 'update'): Promise<void> {
    if (inFlightToolIds.has(toolId)) {
      return;
    }
    setInFlightToolIds((prev) => new Set(prev).add(toolId));
    const tool = scan?.tools.find((candidate) => candidate.toolId === toolId);
    const activityId = `tool:${toolId}:${Date.now()}`;
    const label = `${action === 'install' ? 'Installing' : 'Updating'} ${tool?.displayName ?? toolId}`;
    window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label, state: 'running' } }));
    try {
      if (action === 'install') {
        await window.space.environment.installTool({ toolId });
      } else {
        await window.space.environment.updateTool({ toolId });
      }
      window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label, state: 'completed' } }));
      await refresh();
    } catch (caught) {
      window.dispatchEvent(new CustomEvent('space:installation-activity', { detail: { id: activityId, label, state: 'failed', message: caught instanceof Error ? caught.message : String(caught) } }));
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setInFlightToolIds((prev) => {
        const next = new Set(prev);
        next.delete(toolId);
        return next;
      });
    }
  }

  const nodeTool = scan?.tools.find((tool) => tool.toolId === 'node') ?? null;
  const ghTool = scan?.tools.find((tool) => tool.toolId === 'gh') ?? null;
  const essentialToolIds = new Set(['git', 'gh', 'node', 'npm']);
  const essentialTools = scan?.tools.filter((tool) => essentialToolIds.has(tool.toolId)) ?? [];
  const essentialIssues = essentialTools.filter((tool) => !tool.found || tool.meetsMinimumVersion === false);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Main column — scrolls independently of the right rail, same as HomeView. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg">Environment</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={busy}>
              <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} /> Rescan
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void exportReport()} disabled={busy || !scan}>
              <Download size={13} /> Export report
            </Button>
            <Button size="sm" variant="primary" onClick={() => void installMissing()} disabled={busy || missingTools.length === 0}>
              <DownloadCloud size={13} /> Install missing
            </Button>
            <PackageUpdatesMenu />
          </div>
        </div>

        {scan && (
          <>
            <div className="grid grid-cols-5 gap-2">
              <StatTile
                icon={<Laptop2 size={16} className="text-fg-muted" />}
                label="Machine"
                value={`${scan.platform === 'darwin' ? 'macOS' : 'Windows'} · ${scan.architecture}`}
                secondary={scan.osVersion}
              />
              <StatTile
                icon={<ToolIcon toolId="node" />}
                label="Active runtime"
                value={nodeTool?.version ?? '—'}
                secondary={nodeTool?.source ?? (nodeTool?.found ? undefined : 'not found')}
              />
              <StatTile
                icon={scan.packageManager?.id === 'homebrew' ? <ToolIcon toolId="homebrew" /> : <Package size={14} className="text-fg-muted" />}
                label="Package manager"
                value={scan.packageManager ? (scan.packageManager.id === 'homebrew' ? 'Homebrew' : 'WinGet') : '—'}
                secondary={scan.packageManager?.version ?? (scan.packageManager?.found ? undefined : 'not found')}
              />
              <StatTile
                icon={<Terminal size={14} className="text-fg-muted" />}
                label="Shell"
                value={scan.shellName ?? scan.shellPath?.split('/').pop() ?? '—'}
                secondary={scan.shellVersion ?? scan.shellPath ?? undefined}
              />
              <StatTile
                icon={<ToolIcon toolId="gh" />}
                label="GitHub CLI"
                value={ghTool?.version ?? '—'}
                secondary={ghTool?.source ?? (ghTool?.found ? undefined : 'not found')}
              />
            </div>

            <div className="flex min-h-0 flex-1 items-start gap-2">
            <div className="h-full flex-1 self-stretch">
              <PackagesPanel />
            </div>

            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <div>
                  <CardTitle>Toolchain</CardTitle>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {essentialIssues.length === 0 ? 'Ready for project work.' : 'A required tool needs attention.'}
                  </p>
                </div>
                <Badge variant={essentialIssues.length === 0 ? 'success' : 'warning'}>{essentialIssues.length === 0 ? 'Ready' : 'Action needed'}</Badge>
              </CardHeader>
              {essentialIssues.length > 0 && (
                <div className="space-y-1.5 border-b border-border px-3.5 py-2.5">
                  {essentialIssues.map((tool) => {
                    const inFlight = inFlightToolIds.has(tool.toolId);
                    return (
                      <div key={tool.toolId} className="flex items-center justify-between gap-3 rounded-md bg-surface-hover px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 text-fg"><ToolIcon toolId={tool.toolId} /> {tool.displayName}</span>
                        {!tool.found && (
                          <Button size="sm" variant="secondary" disabled={inFlight} onClick={() => void runToolAction(tool.toolId, 'install')}>
                            {inFlight ? <RefreshCw size={12} className="animate-spin" /> : null} Install
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="divide-y divide-border">
                  {scan.tools.map((tool) => {
                    const status = toolStatus(tool);
                      const inFlight = inFlightToolIds.has(tool.toolId);
                      return (
                        <div key={tool.toolId} className="grid grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] items-center gap-3 px-3.5 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2"><ToolIcon toolId={tool.toolId} /><span className="truncate text-fg">{tool.displayName}</span></span>
                          <span className="flex items-center gap-2 text-xs text-fg-muted"><StatusDot tone={status.tone} /><span className="truncate">{tool.version ?? status.label}</span></span>
                          <span className="flex justify-end">
                            {!tool.found && <Button size="sm" variant="ghost" disabled={inFlight} onClick={() => void runToolAction(tool.toolId, 'install')}>Install</Button>}
                          </span>
                        </div>
                      );
                    })}
              </div>
            </Card>
            </div>
          </>
        )}
      </div>

      {/* Right rail — fixed width, own scroll, same pattern as HomeView's "Developer Activity" sidebar. */}
      <div className="flex min-h-0 w-80 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain border-l border-border p-2 [scrollbar-gutter:stable] [&>*]:shrink-0">
        <EnvironmentProjectPanel projectId={selectedProjectId} {...(onRunScript ? { onRunScript } : {})} />
        <EnvironmentServicesPanel workspaceId={activeWorkspaceId} projectId={selectedProjectId} githubReport={githubReport} />
        <AiToolsPanel workspaceId={activeWorkspaceId} projectId={selectedProjectId} />
        {scan && (
          <EnvironmentSuggestedActions
            scan={scan}
            onInstallTool={(toolId) => void runToolAction(toolId, 'install')}
            busyToolIds={inFlightToolIds}
          />
        )}
      </div>
    </div>
  );
}
