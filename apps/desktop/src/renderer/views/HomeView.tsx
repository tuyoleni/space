import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  ArrowUpCircle,
  Box,
  CircleDot,
  Clock,
  Cpu,
  Download,
  FolderPlus,
  GitBranch,
  GitFork,
  GitPullRequest,
  MemoryStick,
  Moon,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Sun,
  Sunrise,
  Sunset,
  TerminalSquare,
  Zap,
} from 'lucide-react';
import type {
  DependencyScanResult,
  EnvironmentScanResult,
  GitStatusSummary,
  GithubAuthReport,
  GithubIssueSummary,
  GithubPullRequestSummary,
  JsPackageManagerId,
  Project,
  ServiceKind,
  SystemProcessInfo,
  SystemStatsResult,
  TerminalSessionInfo,
  WorkspaceSummary,
} from '@space/contracts';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardRows, CardTitle, StatusDot, formatRelativeTime } from '@space/ui';
import type { NavView } from '../nav';
import type { ProjectActions, ProjectRuntimeState } from '../AppShell';
import { BrandIcon, TOOL_BRAND, brandForPackage } from '../brand-icons';
import { ProjectIcon } from '../ProjectIcon';

const STATS_POLL_MS = 3_000;
const SPARK_SAMPLES = 20;

interface HomeViewProps {
  readonly workspace: WorkspaceSummary;
  readonly projects: readonly Project[];
  readonly selectedProject: Project | null;
  readonly gitStatus: GitStatusSummary | null;
  readonly envScan: EnvironmentScanResult | null;
  readonly githubReport: GithubAuthReport | null;
  readonly runtime: ProjectRuntimeState;
  readonly actions: ProjectActions;
  readonly busy: boolean;
  readonly changedFileCount: number;
  readonly onNavigate: (view: NavView) => void;
  readonly onNewProject: () => void;
  readonly onAddFolder: () => void;
  readonly onCloneRepository: () => void;
  readonly onFetch: () => void;
  readonly onPush: () => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Greeting glyph driven by the real local time of day: pre-dawn/night moon,
 * dawn/dusk sun-rise/-set, midday sun. (Live outdoor weather would need a
 * location + weather API — a network call we don't make yet.)
 */
function GreetingIcon() {
  const hour = new Date().getHours();
  if (hour < 6 || hour >= 20) return <Moon size={26} className="text-accent-hover" />;
  if (hour < 8) return <Sunrise size={26} className="text-warning" />;
  if (hour < 18) return <Sun size={26} className="text-warning" />;
  return <Sunset size={26} className="text-warning" />;
}

/** Real brand icon for a toolchain entry, with a lucide fallback for the few (e.g. Volta) that have no Simple Icon. */
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

/** Tiny bar chart over the last N real samples — values are 0-100 percents. */
function SparkBars({ values }: { readonly values: readonly number[] }) {
  return (
    <div className="flex h-9 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: SPARK_SAMPLES }, (_, index) => {
        const value = values[values.length - SPARK_SAMPLES + index];
        return (
          <div
            key={index}
            className="w-[4px] rounded-sm bg-accent"
            style={{ height: `${value === undefined ? 2 : Math.max(8, Math.min(100, value))}%`, opacity: value === undefined ? 0.15 : 0.85 }}
          />
        );
      })}
    </div>
  );
}

/** Horizontal fill meter (0-100). Real percentage, not decorative. */
function Meter({ percent }: { readonly percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8" aria-hidden>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

/**
 * One metric row of the Developer Activity card: a label, the current value
 * with a right-aligned secondary stat, a fill meter, and the live spark.
 * Mirrors the reference's CPU/Memory/Processes rows exactly.
 */
function MetricRow({
  icon,
  label,
  value,
  secondary,
  percent,
  samples,
}: {
  readonly icon: JSX.Element;
  readonly label: string;
  readonly value: string;
  readonly secondary?: string | undefined;
  readonly percent: number | null;
  readonly samples?: readonly number[] | undefined;
}) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          {icon} {label}
        </span>
        {secondary && <span className="text-[11px] text-fg-faint">{secondary}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-xl font-semibold text-fg">{value}</p>
        {samples && <SparkBars values={samples} />}
      </div>
      {percent !== null && <Meter percent={percent} />}
    </div>
  );
}

export function HomeView({
  workspace,
  projects,
  selectedProject,
  gitStatus,
  envScan,
  githubReport,
  runtime,
  actions,
  busy,
  changedFileCount,
  onNavigate,
  onNewProject,
  onAddFolder,
  onCloneRepository,
  onFetch,
  onPush,
}: HomeViewProps) {
  const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([]);
  const [prs, setPrs] = useState<readonly GithubPullRequestSummary[] | null>(null);
  const [issues, setIssues] = useState<readonly GithubIssueSummary[] | null>(null);
  const [depScan, setDepScan] = useState<DependencyScanResult | null>(null);
  const [packageManager, setPackageManager] = useState<JsPackageManagerId | null>(null);
  const [depsBusy, setDepsBusy] = useState(false);
  const [stats, setStats] = useState<SystemStatsResult | null>(null);
  const [processes, setProcesses] = useState<readonly SystemProcessInfo[]>([]);
  const cpuSamples = useRef<number[]>([]);
  const memSamples = useRef<number[]>([]);

  const refreshTerminals = useCallback(async () => {
    const list = await window.space.terminal.list(workspace.id);
    setTerminals(list.filter((session) => session.state === 'running'));
  }, [workspace.id]);

  useEffect(() => {
    void refreshTerminals();
  }, [refreshTerminals]);

  // Real open PRs + issues, only when actually authenticated — never guessed.
  // Their counts feed the stat trio and the most-recent few feed the
  // activity list below it. Scoped to the selected project so the list
  // reflects its repo rather than whatever directory the host process
  // happens to be running in; with no project selected there's nothing to
  // scope to, so skip the call entirely rather than showing another repo's data.
  useEffect(() => {
    setPrs(null);
    setIssues(null);
    if (!githubReport?.authenticated || !selectedProject) {
      return;
    }
    const projectId = selectedProject.id;
    void window.space.github.prList({ workspaceId: workspace.id, projectId, state: 'open' }).then(setPrs, () => setPrs(null));
    void window.space.github.issueList({ workspaceId: workspace.id, projectId, state: 'open' }).then(setIssues, () => setIssues(null));
  }, [workspace.id, selectedProject, githubReport?.authenticated]);

  const prCount = prs?.length ?? null;
  const issueCount = issues?.length ?? null;
  // Merge open PRs + issues into one recent-activity feed, newest first.
  const githubActivity = [
    ...(prs ?? []).map((pr) => ({ kind: 'pr' as const, number: pr.number, title: pr.title, updatedAt: pr.updatedAt, author: pr.author })),
    ...(issues ?? []).map((issue) => ({ kind: 'issue' as const, number: issue.number, title: issue.title, updatedAt: issue.updatedAt, author: issue.author })),
  ]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 4);

  // Real dependency scan for the selected project's package manager.
  const scanDeps = useCallback(async () => {
    if (!selectedProject) {
      setDepScan(null);
      setPackageManager(null);
      return;
    }
    const detection = await window.space.project.detectPackageManager({ canonicalPath: selectedProject.canonicalPath });
    if (!detection.packageManager) {
      setPackageManager(null);
      setDepScan(null);
      return;
    }
    setPackageManager(detection.packageManager);
    setDepScan(await window.space.dependencies.scan({ canonicalPath: selectedProject.canonicalPath, packageManager: detection.packageManager }));
  }, [selectedProject]);

  useEffect(() => {
    setDepScan(null);
    setPackageManager(null);
    void scanDeps();
  }, [scanDeps]);

  // Install/update run the real (trust-gated) package-manager command, then
  // re-scan so the outdated/vulnerability counts reflect the new state.
  async function runDeps(kind: 'install' | 'update'): Promise<void> {
    if (!selectedProject || depsBusy) {
      return;
    }
    setDepsBusy(true);
    try {
      const allowOnce = selectedProject.trustState === 'untrusted';
      if (kind === 'install') {
        await window.space.project.installDependencies({ projectId: selectedProject.id, allowOnce });
      } else {
        await window.space.project.updateDependencies({ projectId: selectedProject.id, allowOnce });
      }
      await scanDeps();
    } finally {
      setDepsBusy(false);
    }
  }

  // Live resource sampling while Home is visible.
  useEffect(() => {
    let cancelled = false;
    async function sample(): Promise<void> {
      const [nextStats, nextProcesses] = await Promise.all([window.space.system.stats(), window.space.system.processes()]);
      if (cancelled) {
        return;
      }
      cpuSamples.current = [...cpuSamples.current, nextStats.cpuPercent].slice(-SPARK_SAMPLES);
      const memPercent = Math.round(((nextStats.memoryTotalBytes - nextStats.memoryFreeBytes) / nextStats.memoryTotalBytes) * 100);
      memSamples.current = [...memSamples.current, memPercent].slice(-SPARK_SAMPLES);
      setStats(nextStats);
      setProcesses(nextProcesses);
    }
    void sample();
    const timer = setInterval(() => void sample(), STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 4);

  const runningServices = projects.flatMap((project) =>
    (runtime.services[project.id] ?? []).filter((service) => service.state === 'running').map((service) => ({ project, service })),
  );
  const serviceKindIcon: Record<ServiceKind, typeof Play> = { devServer: Play, container: Box, process: Cpu };

  const requiredTools = envScan?.tools ?? [];
  const allToolsReady = requiredTools.length > 0 && requiredTools.every((tool) => tool.found);
  const memoryUsedGb = stats ? (stats.memoryTotalBytes - stats.memoryFreeBytes) / 1024 ** 3 : null;

  return (
    <div className="flex h-full">
      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <GreetingIcon />
            <div>
              <h1 className="text-xl font-semibold text-fg">
                {greeting()}
                {envScan?.gitUserName ? `, ${envScan.gitUserName.split(' ')[0]}` : ''}.
              </h1>
              <p className="text-sm text-fg-muted">
                {allToolsReady ? 'Everything looks ready to build something great.' : `Everything in ${workspace.name}.`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={onNewProject} disabled={busy}>
              <Plus size={13} /> New Project
            </Button>
            <Button variant="secondary" size="sm" onClick={onAddFolder} disabled={busy}>
              <FolderPlus size={13} /> Add Folder
            </Button>
            <Button variant="secondary" size="sm" onClick={onCloneRepository} disabled={busy}>
              <GitFork size={13} /> Clone
            </Button>
          </div>
        </div>

        {/* Environment / GitHub / Recent Projects / Terminals / Services / Quick Actions —
            one grid with equal rows so every block is the same size. */}
        <div className="grid auto-rows-fr grid-cols-3 gap-2">
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              {allToolsReady && <Badge variant="success">Ready</Badge>}
            </CardHeader>
            <CardRows className="flex-1">
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
            <CardFooter>
              <button type="button" className="flex w-full items-center justify-between text-xs text-accent hover:underline" onClick={() => onNavigate('environment')}>
                View all <ArrowRight size={12} />
              </button>
            </CardFooter>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>GitHub</CardTitle>
              {githubReport?.authenticated ? <Badge variant="success">Connected</Badge> : <Badge>Offline</Badge>}
            </CardHeader>
            <CardRows className="flex-1">
              <div className="flex items-center gap-2.5 py-2">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover">
                  <GitFork size={16} className="text-fg" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {githubReport?.authenticated && githubReport.activeAccount ? githubReport.activeAccount.account : 'Not connected'}
                  </span>
                  <span className="block truncate text-[11px] text-fg-faint">
                    {githubReport?.activeAccount
                      ? `${githubReport.activeAccount.host} · ${githubReport.gitProtocol ?? 'protocol unknown'}${githubReport.cliVersion ? ` · gh ${githubReport.cliVersion}` : ''}`
                      : 'GitHub Account'}
                  </span>
                </span>
              </div>
              {githubReport?.authenticated && (
                <div className="flex divide-x divide-border py-2.5">
                  <div className="flex-1 pr-4">
                    <p className="text-base font-semibold text-fg">{prCount ?? '—'}</p>
                    <p className="text-xs text-fg-muted">PRs</p>
                  </div>
                  <div className="flex-1 px-4">
                    <p className="text-base font-semibold text-fg">{issueCount ?? '—'}</p>
                    <p className="text-xs text-fg-muted">Issues</p>
                  </div>
                  <div className="flex-1 pl-4">
                    <p className="text-base font-semibold text-fg">{githubReport.accounts.length}</p>
                    <p className="text-xs text-fg-muted">Accounts</p>
                  </div>
                </div>
              )}
              {githubReport?.authenticated &&
                (githubActivity.length === 0 ? (
                  <p className="py-2.5 text-xs text-fg-faint">No open pull requests or issues.</p>
                ) : (
                  githubActivity.map((item) => {
                    const updated = formatRelativeTime(item.updatedAt);
                    return (
                      <div key={`${item.kind}-${item.number}`} className="flex items-center gap-2.5 py-2">
                        {item.kind === 'pr' ? (
                          <GitPullRequest size={14} className="shrink-0 text-accent" />
                        ) : (
                          <CircleDot size={14} className="shrink-0 text-success" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">
                            <span className="text-fg-faint">#{item.number}</span> {item.title}
                          </span>
                          <span className="block truncate text-[11px] text-fg-faint">
                            {item.author} · {updated.relative}
                          </span>
                        </span>
                      </div>
                    );
                  })
                ))}
            </CardRows>
            <CardFooter>
              <button type="button" className="flex w-full items-center justify-between text-xs text-accent hover:underline" onClick={() => onNavigate('changes')}>
                Open GitHub <ArrowRight size={12} />
              </button>
            </CardFooter>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Recent Projects</CardTitle>
            </CardHeader>
            <CardRows className="flex-1">
              {recentProjects.length === 0 && <p className="py-2 text-sm text-fg-faint">No projects yet.</p>}
              {recentProjects.map((project) => {
                const updated = formatRelativeTime(project.updatedAt);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => actions.selectProject(project)}
                    className="flex items-center justify-between gap-2 py-2.5 text-left text-sm hover:text-accent-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProjectIcon projectId={project.id} canonicalPath={project.canonicalPath} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{project.name}</span>
                        <span className="block truncate text-[11px] text-fg-faint">{project.canonicalPath.replace(/^\/Users\/[^/]+/, '~')}</span>
                      </span>
                    </span>
                    <time className="shrink-0 text-xs text-fg-faint" dateTime={project.updatedAt} title={updated.exact}>
                      {updated.relative}
                    </time>
                  </button>
                );
              })}
            </CardRows>
            <CardFooter>
              <button
                type="button"
                className="flex w-full items-center justify-between text-xs text-accent hover:underline"
                onClick={() => onNavigate('projects')}
              >
                Open All Projects <ArrowRight size={12} />
              </button>
            </CardFooter>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Terminals</CardTitle>
              <Badge variant={terminals.length > 0 ? 'success' : 'neutral'}>{terminals.length} running</Badge>
            </CardHeader>
            <CardRows className="flex-1">
              {terminals.length === 0 && <p className="py-2 text-sm text-fg-faint">All quiet.</p>}
              {terminals.slice(0, 4).map((session) => {
                const project = projects.find((candidate) => candidate.id === session.projectId);
                return (
                  <div key={session.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="flex items-center gap-2 text-fg">
                      <TerminalSquare size={13} className="text-fg-muted" />
                      {project?.name ?? 'workspace'}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                      {session.shell.split('/').pop()} · pid {session.pid}
                      <StatusDot tone="success" />
                    </span>
                  </div>
                );
              })}
            </CardRows>
            <CardFooter>
              <button type="button" className="flex w-full items-center gap-1.5 text-xs font-medium text-accent hover:underline" onClick={() => onNavigate('terminal')}>
                <Plus size={13} /> New Terminal
              </button>
            </CardFooter>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Services</CardTitle>
              <Badge variant={runningServices.length > 0 ? 'success' : 'neutral'}>{runningServices.length} running</Badge>
            </CardHeader>
            <CardRows className="flex-1">
              {runningServices.length === 0 && (
                <p className="py-2 text-sm text-fg-faint">
                  {selectedProject ? `No services running for ${selectedProject.name}.` : 'No services running.'}
                </p>
              )}
              {runningServices.slice(0, 4).map(({ project, service }) => {
                const KindIcon = serviceKindIcon[service.kind];
                return (
                  <div key={`${service.kind}-${service.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <KindIcon size={13} className="shrink-0 text-fg-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-fg">{project.name}</span>
                        <span className="block truncate text-[11px] text-fg-faint">{service.label}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {service.detail && <span className="text-xs text-fg-muted">{service.detail}</span>}
                      <Button size="sm" variant="ghost" onClick={() => actions.stopService(project, service)} disabled={busy} aria-label={`Stop ${service.label}`}>
                        <Square size={11} />
                      </Button>
                    </span>
                  </div>
                );
              })}
            </CardRows>
            <CardFooter>
              {selectedProject ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  disabled={busy || runningServices.some(({ project, service }) => project.id === selectedProject.id && service.kind === 'devServer')}
                  onClick={() => actions.startDevServer(selectedProject, selectedProject.trustState === 'untrusted')}
                >
                  <Play size={13} /> Start dev server
                </button>
              ) : (
                <span className="text-xs text-fg-faint">Select a project to run its dev server.</span>
              )}
            </CardFooter>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardRows className="flex-1">
              <button
                type="button"
                onClick={() => onNavigate('changes')}
                className="flex items-center justify-between py-1.5 text-sm text-fg hover:text-accent-hover"
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Pencil size={14} className="text-fg-muted" /> Open Changes
                </span>
                <span className="flex items-center gap-1.5 text-xs text-fg-faint">
                  {changedFileCount} files <ArrowRight size={13} className="text-fg-muted" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('changes')}
                className="flex items-center justify-between py-1.5 text-sm text-fg hover:text-accent-hover"
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Clock size={14} className="text-fg-muted" /> View History
                </span>
                <ArrowRight size={13} className="text-fg-muted" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('terminal')}
                className="flex items-center justify-between py-1.5 text-sm text-fg hover:text-accent-hover"
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <TerminalSquare size={14} className="text-fg-muted" /> New Terminal
                </span>
                <ArrowRight size={13} className="text-fg-muted" />
              </button>
              {selectedProject && (
                <button
                  type="button"
                  onClick={() => actions.install(selectedProject, selectedProject.trustState === 'untrusted')}
                  disabled={busy}
                  className="flex items-center justify-between py-1.5 text-sm text-fg hover:text-accent-hover disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Download size={14} className="text-fg-muted" /> Install Dependencies
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-fg-faint">
                    {packageManager && `${packageManager} install`} <ArrowRight size={13} className="text-fg-muted" />
                  </span>
                </button>
              )}
            </CardRows>
          </Card>
        </div>

        {/* Dependencies + Git status */}
        <div className="grid auto-rows-fr grid-cols-2 gap-2">
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>
                <span className="flex items-center gap-2">
                  Dependencies
                  {packageManager && <Badge variant="accent">{packageManager}</Badge>}
                </span>
              </CardTitle>
              {selectedProject && (
                <span className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => void runDeps('install')} disabled={depsBusy}>
                    <Download size={12} /> Install
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void runDeps('update')}
                    disabled={depsBusy || (depScan?.outdatedCount ?? 0) === 0}
                  >
                    <ArrowUpCircle size={12} className={depsBusy ? 'animate-spin' : undefined} /> {depsBusy ? 'Working…' : 'Update'}
                  </Button>
                </span>
              )}
            </CardHeader>
            {!selectedProject ? (
              <CardContent className="flex-1"><p className="text-sm text-fg-faint">Select a project to scan its dependencies.</p></CardContent>
            ) : !depScan ? (
              <CardContent className="flex-1"><p className="text-sm text-fg-faint">Scanning with {packageManager ?? 'detected package manager'}&hellip;</p></CardContent>
            ) : !depScan.supported ? (
              <CardContent className="flex-1"><p className="text-sm text-fg-faint">{depScan.reason}</p></CardContent>
            ) : (
              <>
                <CardRows>
                  <div className="flex divide-x divide-border py-2.5">
                    <div className="flex-1 pr-4">
                      <p className={`text-lg font-semibold ${(depScan.outdatedCount ?? 0) > 0 ? 'text-warning' : 'text-fg'}`}>
                        {depScan.outdatedCount ?? '—'}
                      </p>
                      <p className="text-xs text-fg-muted">Outdated</p>
                    </div>
                    <div className="flex-1 pl-4">
                      <p className={`text-lg font-semibold ${(depScan.vulnerabilities?.total ?? 0) > 0 ? 'text-danger' : 'text-fg'}`}>
                        {depScan.vulnerabilities?.total ?? '—'}
                      </p>
                      <p className="text-xs text-fg-muted">Vulns</p>
                    </div>
                  </div>
                </CardRows>
                {/* Every outdated package, scrollable — no "and N more" cutoff. */}
                <CardRows className="max-h-56 flex-1 overflow-y-auto">
                  {(depScan.outdatedPackages ?? []).length === 0 && <p className="py-2 text-sm text-fg-faint">Everything is up to date.</p>}
                  {(depScan.outdatedPackages ?? []).map((pkg) => {
                    const brand = brandForPackage(pkg.name);
                    return (
                      <div key={pkg.name} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          {brand ? <BrandIcon icon={brand} size={14} /> : <Package size={14} className="shrink-0 text-fg-faint" />}
                          <span className="truncate text-fg">{pkg.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-fg-muted">
                          {pkg.current ?? '?'} <span className="text-fg-faint">→</span> <span className="text-success">{pkg.latest ?? pkg.wanted ?? '?'}</span>
                        </span>
                      </div>
                    );
                  })}
                </CardRows>
                {depScan.vulnerabilities && depScan.vulnerabilities.total > 0 && (
                  <CardFooter>
                    <span className="text-[11px] text-fg-faint">
                      {(['critical', 'high', 'moderate', 'low'] as const)
                        .map((severity) => ({ severity, count: depScan.vulnerabilities?.[severity] ?? 0 }))
                        .filter(({ count }) => count > 0)
                        .map(({ severity, count }) => `${count} ${severity}`)
                        .join(' · ')}{' '}
                      vulnerabilities
                    </span>
                  </CardFooter>
                )}
              </>
            )}
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Git Status</CardTitle>
              {gitStatus && (
                <span className="flex items-center gap-1.5">
                  {gitStatus.branch.upstream && (gitStatus.branch.ahead ?? 0) === 0 && (gitStatus.branch.behind ?? 0) === 0 ? (
                    <Badge variant="success">Up to date</Badge>
                  ) : gitStatus.branch.upstream ? (
                    <Badge variant="warning">
                      +{gitStatus.branch.ahead ?? 0}/-{gitStatus.branch.behind ?? 0}
                    </Badge>
                  ) : (
                    <Badge>No upstream</Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={onFetch} disabled={busy} aria-label="Fetch">
                    <RefreshCw size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onPush}
                    disabled={busy || !gitStatus.branch.branchName || (!!gitStatus.branch.upstream && (gitStatus.branch.ahead ?? 0) === 0)}
                  >
                    <ArrowUp size={12} /> Push
                  </Button>
                </span>
              )}
            </CardHeader>
            {!selectedProject ? (
              <CardContent className="flex-1"><p className="text-sm text-fg-faint">Select a project to see its Git status.</p></CardContent>
            ) : !gitStatus ? (
              <CardContent className="flex-1"><p className="text-sm text-fg-faint">Loading&hellip;</p></CardContent>
            ) : (
              <>
                <CardRows className="flex-1">
                  <div className="py-2.5">
                    <p className="flex items-center gap-2 text-sm text-fg">
                      <GitBranch size={14} className="text-fg-muted" />
                      On branch <span className="font-medium">{gitStatus.branch.detached ? '(detached)' : gitStatus.branch.branchName ?? '—'}</span>
                    </p>
                    {gitStatus.branch.upstream && <p className="pl-6 text-[11px] text-fg-faint">tracking {gitStatus.branch.upstream}</p>}
                  </div>
                  <div className="flex divide-x divide-border py-2.5">
                    <button
                      type="button"
                      className="flex-1 pr-4 text-left"
                      onClick={() => onNavigate('changes')}
                      disabled={changedFileCount === 0}
                    >
                      <p className="text-base font-semibold text-fg">{changedFileCount}</p>
                      <p className={`text-xs ${changedFileCount > 0 ? 'text-accent hover:underline' : 'text-fg-muted'}`}>Changes</p>
                    </button>
                    <button
                      type="button"
                      className="flex-1 px-4 text-left"
                      onClick={() => onNavigate('changes')}
                      disabled={gitStatus.conflictedFiles.length === 0}
                    >
                      <p className={`text-lg font-semibold ${gitStatus.conflictedFiles.length > 0 ? 'text-danger' : 'text-fg'}`}>
                        {gitStatus.conflictedFiles.length}
                      </p>
                      <p className={`text-xs ${gitStatus.conflictedFiles.length > 0 ? 'text-danger hover:underline' : 'text-fg-muted'}`}>
                        Conflicts
                      </p>
                    </button>
                    <div className="flex-1 pl-4">
                      <p className="text-base font-semibold text-fg">
                        {gitStatus.branch.upstream ? `${gitStatus.branch.ahead ?? 0}↑ ${gitStatus.branch.behind ?? 0}↓` : '—'}
                      </p>
                      <p className="text-xs text-fg-muted">Ahead/Behind</p>
                    </div>
                  </div>
                </CardRows>
                <CardFooter>
                  <button type="button" className="flex w-full items-center justify-between text-xs text-accent hover:underline" onClick={() => onNavigate('changes')}>
                    Open Changes <ArrowRight size={12} />
                  </button>
                </CardFooter>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Right rail */}
      <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border p-2">
        <Card>
          <CardHeader>
            <CardTitle>Developer Activity</CardTitle>
            <Badge variant="success">
              <span className="flex items-center gap-1">
                Live <StatusDot tone="success" pulse />
              </span>
            </Badge>
          </CardHeader>
          <CardRows>
            <MetricRow
              icon={<Cpu size={12} />}
              label="CPU"
              value={stats ? `${stats.cpuPercent}%` : '—'}
              secondary={stats ? `${stats.cpuCount} cores` : undefined}
              percent={stats?.cpuPercent ?? null}
              samples={cpuSamples.current}
            />
            <MetricRow
              icon={<MemoryStick size={12} />}
              label="Memory"
              value={memoryUsedGb !== null ? `${memoryUsedGb.toFixed(1)} GB` : '—'}
              secondary={stats ? `${(stats.memoryTotalBytes / 1024 ** 3).toFixed(0)} GB total` : undefined}
              percent={stats ? ((stats.memoryTotalBytes - stats.memoryFreeBytes) / stats.memoryTotalBytes) * 100 : null}
              samples={memSamples.current}
            />
            <MetricRow
              icon={<Activity size={12} />}
              label="Processes"
              value={stats?.processCount != null ? String(stats.processCount) : '—'}
              secondary={stats ? `load ${stats.loadAverage[0].toFixed(2)}` : undefined}
              percent={null}
            />
          </CardRows>
          <CardFooter>
            <button type="button" className="flex w-full items-center justify-between text-xs text-accent hover:underline" onClick={() => onNavigate('system')}>
              Open Activity Monitor <ArrowRight size={12} />
            </button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Processes</CardTitle>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => onNavigate('system')}>
              View All
            </button>
          </CardHeader>
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
            <span>Name</span>
            <span className="flex gap-4">
              <span className="w-12 text-right">CPU</span>
              <span className="w-12 text-right">Mem</span>
            </span>
          </div>
          {processes.length === 0 ? (
            <CardContent><p className="text-sm text-fg-faint">No process data on this platform.</p></CardContent>
          ) : (
            <CardRows className="max-h-72 overflow-y-auto">
              {processes.map((proc) => (
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
            <CardTitle>Environment</CardTitle>
            <Badge variant="success">Active</Badge>
          </CardHeader>
          {envScan ? (
            <CardRows>
              {envScan.tools
                .filter((tool) => ['node', 'npm'].includes(tool.toolId))
                .map((tool) => (
                  <div key={tool.toolId} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-fg">{tool.displayName}</span>
                    <span className="text-fg-muted">{tool.version ?? 'not found'}</span>
                  </div>
                ))}
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-fg">Shell</span>
                <span className="text-fg-muted">{envScan.shellPath?.split('/').pop() ?? 'unknown'}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-fg">OS</span>
                <span className="text-fg-muted">
                  {envScan.platform === 'darwin' ? 'macOS' : 'Windows'} · {envScan.architecture}
                </span>
              </div>
            </CardRows>
          ) : (
            <CardContent><p className="text-sm text-fg-faint">Scanning&hellip;</p></CardContent>
          )}
          <CardFooter>
            <button type="button" className="flex w-full items-center justify-between text-xs text-accent hover:underline" onClick={() => onNavigate('environment')}>
              View Environment <ArrowRight size={12} />
            </button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
