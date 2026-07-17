import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, DownloadCloud, Download, Laptop2, Package, RefreshCw, Terminal, Zap } from 'lucide-react';
import type { EnvironmentScanResult, EnvironmentScanToolResult, GithubAuthReport } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, StatusDot, useToast } from '@space/ui';
import { BrandIcon, TOOL_BRAND } from '../brand-icons';
import { EnvironmentProjectPanel } from '../EnvironmentProjectPanel';
import { EnvironmentServicesPanel } from '../EnvironmentServicesPanel';
import { EnvironmentSuggestedActions } from '../EnvironmentSuggestedActions';
import { PackagesPanel } from '../PackagesPanel';

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
      <CardContent className="flex items-center gap-2.5 py-3">
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
}

export function EnvironmentView({ selectedProjectId, activeWorkspaceId, githubReport }: EnvironmentViewProps) {
  const { toast } = useToast();
  const [scan, setScan] = useState<EnvironmentScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
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
        // eslint-disable-next-line no-await-in-loop -- installs must run one at a time, never race.
        await window.space.environment.installTool({ toolId: tool.toolId });
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
    try {
      if (action === 'install') {
        await window.space.environment.installTool({ toolId });
      } else {
        await window.space.environment.updateTool({ toolId });
      }
      await refresh();
    } catch (caught) {
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

  return (
    <div className="flex h-full">
      {/* Main column — scrolls independently of the right rail, same as HomeView. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
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
          </div>
        </div>

        {scan && (
          <>
            <div className="grid grid-cols-5 gap-3">
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

            <div className="flex min-h-0 flex-1 items-start gap-4">
            <div className="h-full flex-1 self-stretch">
              <PackagesPanel />
            </div>

            <Card className="flex-1">
              <CardHeader>
                <CardTitle>Core toolchain</CardTitle>
                <Badge variant="neutral">{scan.tools.length} tools</Badge>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                      <th className="px-3.5 py-2 text-left">Tool</th>
                      <th className="px-3.5 py-2 text-left">Status</th>
                      <th className="px-3.5 py-2 text-left">Version</th>
                      <th className="px-3.5 py-2 text-left">Source</th>
                      <th className="px-3.5 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {scan.tools.map((tool) => {
                      const status = toolStatus(tool);
                      const expanded = expandedToolId === tool.toolId;
                      const inFlight = inFlightToolIds.has(tool.toolId);
                      return (
                        <Fragment key={tool.toolId}>
                          <tr className="hover:bg-surface-hover">
                            <td className="px-3.5 py-2">
                              <span className="flex items-center gap-2 text-fg">
                                <ToolIcon toolId={tool.toolId} /> {tool.displayName}
                              </span>
                            </td>
                            <td className="px-3.5 py-2">
                              <span className="flex items-center gap-1.5 text-fg-muted">
                                <StatusDot tone={status.tone} /> {status.label}
                              </span>
                            </td>
                            <td className="px-3.5 py-2">
                              <span className="flex items-center gap-1.5 text-fg-muted">
                                {tool.version ?? '—'}
                                {tool.updateAvailable === true && (
                                  <Badge variant="warning">update available{tool.latestVersion ? ` · ${tool.latestVersion}` : ''}</Badge>
                                )}
                              </span>
                            </td>
                            <td className="px-3.5 py-2 text-fg-muted">{tool.source ?? '—'}</td>
                            <td className="px-3.5 py-2 text-right">
                              {tool.found && tool.updateAvailable === true ? (
                                <Button size="sm" variant="ghost" disabled={inFlight} onClick={() => void runToolAction(tool.toolId, 'update')}>
                                  {inFlight ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />} Update
                                </Button>
                              ) : !tool.found ? (
                                <Button size="sm" variant="ghost" disabled={inFlight} onClick={() => void runToolAction(tool.toolId, 'install')}>
                                  {inFlight ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />} Install
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setExpandedToolId(expanded ? null : tool.toolId)}
                                >
                                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
                                </Button>
                              )}
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={5} className="bg-surface-hover/40 px-3.5 py-2 text-xs text-fg-faint">
                                path: {tool.path ?? '—'} · meets minimum version:{' '}
                                {tool.meetsMinimumVersion === null ? 'unknown' : tool.meetsMinimumVersion ? 'yes' : 'no'}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            </div>
          </>
        )}
      </div>

      {/* Right rail — fixed width, own scroll, same pattern as HomeView's "Developer Activity" sidebar. */}
      <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4">
        <EnvironmentProjectPanel projectId={selectedProjectId} />
        <EnvironmentServicesPanel workspaceId={activeWorkspaceId} projectId={selectedProjectId} githubReport={githubReport} />
        {scan && (
          <EnvironmentSuggestedActions
            scan={scan}
            onInstallTool={(toolId) => void runToolAction(toolId, 'install')}
            onUpdateTool={(toolId) => void runToolAction(toolId, 'update')}
            busyToolIds={inFlightToolIds}
          />
        )}
      </div>
    </div>
  );
}
