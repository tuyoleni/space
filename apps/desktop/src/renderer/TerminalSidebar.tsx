import { Cpu, Download, Eraser, Package, Plus, Search, Zap } from 'lucide-react';
import type { EnvironmentScanResult, SystemProcessInfo, SystemStatsResult, TerminalSessionInfo } from '@space/contracts';
import { Badge, Card, CardContent, CardHeader, CardRows, CardTitle, EmptyState, formatRelativeTime } from '@space/ui';
import { BrandIcon, TOOL_BRAND } from './brand-icons';

const TOP_PROCESS_COUNT = 6;

interface TerminalSidebarProps {
  readonly session: TerminalSessionInfo | null;
  readonly envScan: EnvironmentScanResult | null;
  readonly stats: SystemStatsResult | null;
  readonly processes: readonly SystemProcessInfo[];
  readonly onNewTerminal: () => void;
  readonly onClear: () => void;
  readonly onFind: () => void;
  readonly onExport: () => void;
}

/** Real brand icon for a toolchain entry, with a lucide fallback for the few (e.g. Volta) that have no Simple Icon. Mirrors HomeView's ToolIcon. */
function ToolIcon({ toolId }: { readonly toolId: string }) {
  const brand = TOOL_BRAND[toolId];
  if (brand) {
    return <BrandIcon icon={brand} size={15} />;
  }
  if (toolId === 'volta') {
    return <Zap size={15} className="text-accent" />;
  }
  return <Package size={15} className="text-fg-muted" />;
}

export function TerminalSidebar({ session, envScan, stats, processes, onNewTerminal, onClear, onFind, onExport }: TerminalSidebarProps) {
  const requiredTools = envScan?.tools ?? [];
  const allToolsReady = requiredTools.length > 0 && requiredTools.every((tool) => tool.found);
  const topProcesses = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, TOP_PROCESS_COUNT);
  const started = session ? formatRelativeTime(session.startedAt) : null;

  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border p-2">
      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          {allToolsReady && <Badge variant="success">Ready</Badge>}
        </CardHeader>
        <CardRows>
          {requiredTools.map((tool) => (
            <div key={tool.toolId} className="flex items-center justify-between py-1.5 text-sm">
              <span className={`flex items-center gap-2 text-fg ${tool.found ? '' : 'opacity-50'}`}>
                <ToolIcon toolId={tool.toolId} />
                {tool.displayName}
              </span>
              <span className={tool.found ? 'text-fg-muted' : 'text-fg-faint'}>
                {tool.version ?? (tool.found ? 'found' : 'not found')}
              </span>
            </div>
          ))}
          {envScan?.packageManager && (
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className={`flex items-center gap-2 text-fg ${envScan.packageManager.found ? '' : 'opacity-50'}`}>
                {envScan.packageManager.id === 'homebrew' ? (
                  <ToolIcon toolId="homebrew" />
                ) : (
                  <Package size={15} className="text-fg-muted" />
                )}
                {envScan.packageManager.id === 'homebrew' ? 'Homebrew' : 'WinGet'}
              </span>
              <span className={envScan.packageManager.found ? 'text-fg-muted' : 'text-fg-faint'}>
                {envScan.packageManager.version ?? (envScan.packageManager.found ? 'found' : 'not found')}
              </span>
            </div>
          )}
        </CardRows>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Terminal</CardTitle>
          {session && <Badge variant="success">Running</Badge>}
        </CardHeader>
        {!session || !started ? (
          <CardContent>
            <EmptyState title="No terminal selected" description="Open or select a terminal to see its shell, working directory, and process." />
          </CardContent>
        ) : (
          <CardRows>
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-fg-muted">Shell</span>
              <span className="truncate text-fg">{session.shell}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-fg-muted">Started</span>
              <time className="text-fg" dateTime={session.startedAt} title={started.exact}>
                {started.relative}
              </time>
            </div>
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-fg-muted">Working Dir</span>
              <span className="truncate text-fg">{session.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-fg-muted">Process ID</span>
              <span className="text-fg">{session.pid}</span>
            </div>
          </CardRows>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Processes</CardTitle>
          {stats?.processCount != null && <Badge>{stats.processCount}</Badge>}
        </CardHeader>
        {topProcesses.length === 0 ? (
          <CardContent>
            <p className="text-sm text-fg-faint">No process data on this platform.</p>
          </CardContent>
        ) : (
          <CardRows>
            {topProcesses.map((proc) => (
              <div key={proc.pid} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {proc.iconDataUrl ? (
                    <img src={proc.iconDataUrl} alt="" className="h-4 w-4 shrink-0" />
                  ) : (
                    <Cpu size={14} className="shrink-0 text-fg-faint" />
                  )}
                  <span className="truncate text-fg">{proc.name}</span>
                </span>
                <span className="flex shrink-0 gap-4 text-xs text-fg-muted">
                  <span className="w-12 text-right">{proc.cpuPercent.toFixed(1)}%</span>
                  <span className="w-12 text-right">{proc.memoryPercent.toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </CardRows>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardRows>
          <button type="button" onClick={onNewTerminal} className="flex items-center gap-2 py-1.5 text-sm text-fg hover:text-accent-hover">
            <Plus size={14} className="text-fg-muted" /> New Terminal
          </button>
          <button type="button" onClick={onFind} className="flex items-center gap-2 py-1.5 text-sm text-fg hover:text-accent-hover">
            <Search size={14} className="text-fg-muted" /> Find in Terminal
          </button>
          <button type="button" onClick={onClear} className="flex items-center gap-2 py-1.5 text-sm text-fg hover:text-accent-hover">
            <Eraser size={14} className="text-fg-muted" /> Clear Terminal
          </button>
          <button type="button" onClick={onExport} className="flex items-center gap-2 py-1.5 text-sm text-fg hover:text-accent-hover">
            <Download size={14} className="text-fg-muted" /> Export Session
          </button>
        </CardRows>
      </Card>
    </div>
  );
}
