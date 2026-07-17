import { useCallback, useEffect, useState } from 'react';
import { Cpu, MemoryStick, RefreshCw, Square, TerminalSquare, X } from 'lucide-react';
import type { Project, SystemStatsResult, TerminalSessionInfo, WorkspaceSummary } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@space/ui';
import type { ProjectActions, ProjectRuntimeState } from '../AppShell';

interface SystemViewProps {
  readonly workspace: WorkspaceSummary;
  readonly projects: readonly Project[];
  readonly runtime: ProjectRuntimeState;
  readonly actions: ProjectActions;
  readonly busy: boolean;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Real dev-resource "task manager" for this workspace — every running dev server and terminal across every project, with the same stop/close actions available elsewhere, just consolidated in one place. */
export function SystemView({ workspace, projects, runtime, actions, busy }: SystemViewProps) {
  const [stats, setStats] = useState<SystemStatsResult | null>(null);
  const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([]);
  const [statsBusy, setStatsBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    setStatsBusy(true);
    try {
      setStats(await window.space.system.stats());
    } finally {
      setStatsBusy(false);
    }
  }, []);

  const refreshTerminals = useCallback(async () => {
    const list = await window.space.terminal.list(workspace.id);
    setTerminals(list.filter((session) => session.state === 'running'));
  }, [workspace.id]);

  useEffect(() => {
    void refreshStats();
    void refreshTerminals();
  }, [refreshStats, refreshTerminals]);

  async function closeTerminal(session: TerminalSessionInfo): Promise<void> {
    await window.space.terminal.dispose({ sessionId: session.id });
    await refreshTerminals();
  }

  const runningServers = projects.flatMap((project) =>
    (runtime.devServers[project.id] ?? [])
      .filter((server) => server.state === 'running')
      .map((server) => ({ project, server })),
  );

  const memoryUsedBytes = stats ? stats.memoryTotalBytes - stats.memoryFreeBytes : 0;
  const memoryPercent = stats ? Math.round((memoryUsedBytes / stats.memoryTotalBytes) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">System</h1>
          <p className="text-sm text-fg-muted">Live machine load and every dev resource this workspace is running.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void refreshStats()} disabled={statsBusy}>
          <RefreshCw size={13} className={statsBusy ? 'animate-spin' : undefined} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <Cpu size={18} className="text-fg-muted" />
            <div>
              <p className="text-xs text-fg-muted">CPU ({stats?.cpuCount ?? '—'} cores)</p>
              <p className="text-lg font-semibold text-fg">{stats ? `${stats.cpuPercent}%` : '—'}</p>
              {stats && <p className="text-xs text-fg-faint">load avg {stats.loadAverage.map((n) => n.toFixed(2)).join(' / ')}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <MemoryStick size={18} className="text-fg-muted" />
            <div>
              <p className="text-xs text-fg-muted">Memory</p>
              <p className="text-lg font-semibold text-fg">{stats ? `${memoryPercent}%` : '—'}</p>
              {stats && (
                <p className="text-xs text-fg-faint">
                  {formatBytes(memoryUsedBytes)} / {formatBytes(stats.memoryTotalBytes)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Running dev servers ({runningServers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {runningServers.length === 0 ? (
            <p className="text-sm text-fg-faint">No dev servers running.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {runningServers.map(({ project, server }) => (
                <div key={server.id} className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm hover:bg-surface-hover">
                  <span className="flex items-center gap-2 text-fg">
                    <Badge variant="success">running</Badge>
                    {project.name}
                    {server.detectedUrl && <span className="text-fg-faint">{server.detectedUrl}</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => actions.stopDevServer(project, server.id)} disabled={busy}>
                    <Square size={12} /> Stop
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Running terminals ({terminals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {terminals.length === 0 ? (
            <EmptyState title="No terminals running" description="Every terminal in this workspace, across every project." />
          ) : (
            <div className="flex flex-col gap-1">
              {terminals.map((session) => {
                const project = projects.find((candidate) => candidate.id === session.projectId);
                return (
                  <div key={session.id} className="flex items-center justify-between rounded px-1.5 py-1.5 text-sm hover:bg-surface-hover">
                    <span className="flex items-center gap-2 text-fg">
                      <TerminalSquare size={13} className="text-fg-muted" />
                      {project?.name ?? 'workspace'} — {session.shell} (pid {session.pid})
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => void closeTerminal(session)}>
                      <X size={12} /> Close
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
