/**
 * Workspace Dashboard: an overview panel showing project health,
 * recent activity, quick actions, and workspace statistics.
 * Replaces the simple HomeView with a richer, data-driven overview.
 */
import { useMemo } from 'react';
import {
  FolderOpen,
  GitBranch,
  Terminal,
  Activity,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { cn } from '@space/ui';
import type { Project, GitStatusSummary, EnvironmentScanResult } from '@space/contracts';
import type { ProjectRuntimeState } from './AppShell';
import type { NavView } from './nav';

interface WorkspaceDashboardProps {
  readonly projects: readonly Project[];
  readonly selectedProject: Project | null;
  readonly gitStatus: GitStatusSummary | null;
  readonly envScan: EnvironmentScanResult | null;
  readonly runtime: ProjectRuntimeState;
  readonly changedFileCount: number;
  readonly onNavigate: (view: NavView) => void;
  readonly onSelectProject: (project: Project) => void;
  readonly onNewProject: () => void;
}

function StatCard({ icon: Icon, label, value, color = 'text-fg', onClick }: {
  icon: typeof FolderOpen;
  label: string;
  value: string | number;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors',
        onClick && 'hover:bg-surface-hover hover:border-border-strong cursor-pointer',
      )}
    >
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover', color)}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-lg font-bold text-fg">{value}</p>
        <p className="text-[10px] text-fg-faint">{label}</p>
      </div>
    </button>
  );
}

function ProjectHealthRow({ project, runtime, onSelect }: {
  project: Project;
  runtime: ProjectRuntimeState;
  onSelect: () => void;
}) {
  const detection = runtime.detections[project.id];
  const devServers = runtime.devServers[project.id] ?? [];
  const isRunning = devServers.some((s) => s.state === 'running');

  return (
    <div
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-hover cursor-pointer"
      onClick={onSelect}
    >
      <FolderOpen size={13} className="shrink-0 text-fg-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{project.name}</p>
        <p className="truncate text-[10px] text-fg-faint">{project.canonicalPath}</p>
      </div>
      {isRunning && (
        <span className="flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success">
          <Activity size={8} />
          running
        </span>
      )}
      <ArrowRight size={11} className="shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

export function WorkspaceDashboard({
  projects,
  selectedProject,
  gitStatus,
  envScan,
  runtime,
  changedFileCount,
  onNavigate,
  onSelectProject,
  onNewProject,
}: WorkspaceDashboardProps) {
  const stats = useMemo(() => {
    const totalProjects = projects.length;
    const runningProjects = Object.values(runtime.devServers).some(
      (servers) => servers.some((s) => s.state === 'running'),
    );
    const hasGit = !!gitStatus;
    return { totalProjects, runningProjects, hasGit };
  }, [projects, runtime, gitStatus]);

  const nodeTool = envScan?.tools.find((t) => t.toolId === 'node');

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-bold text-fg">Workspace Overview</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            {projects.length} project{projects.length === 1 ? '' : 's'} · {nodeTool?.found ? `Node ${nodeTool.version}` : 'No Node detected'}
          </p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            icon={FolderOpen}
            label="Projects"
            value={stats.totalProjects}
            onClick={() => onNavigate('projects')}
          />
          <StatCard
            icon={GitBranch}
            label="Changes"
            value={changedFileCount}
            color={changedFileCount > 0 ? 'text-warning' : 'text-fg-faint'}
            onClick={() => onNavigate('changes')}
          />
          <StatCard
            icon={Terminal}
            label="Terminals"
            value={Object.keys(runtime.openTerminal).length}
            onClick={() => onNavigate('terminal')}
          />
          <StatCard
            icon={Zap}
            label="Services"
            value={Object.values(runtime.services).flat().length}
            color={Object.values(runtime.services).flat().length > 0 ? 'text-success' : 'text-fg-faint'}
          />
        </div>

        {/* Git status */}
        {gitStatus && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-accent" />
                <span className="text-xs font-medium text-fg">
                  {gitStatus.branch.detached ? '(detached HEAD)' : gitStatus.branch.branchName ?? 'No branch'}
                </span>
                {gitStatus.branch.upstream && (
                  <span className="text-[10px] text-fg-faint">→ {gitStatus.branch.upstream}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-fg-faint">
                {gitStatus.branch.ahead !== null && gitStatus.branch.ahead > 0 && (
                  <span className="text-success">{gitStatus.branch.ahead} ahead</span>
                )}
                {gitStatus.branch.behind !== null && gitStatus.branch.behind > 0 && (
                  <span className="text-danger">{gitStatus.branch.behind} behind</span>
                )}
              </div>
            </div>
            {changedFileCount > 0 && (
              <div className="mt-2 flex items-center gap-3 text-[10px]">
                <button
                  type="button"
                  onClick={() => onNavigate('changes')}
                  className="text-accent hover:text-accent-hover"
                >
                  {changedFileCount} changed file{changedFileCount === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Project health */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-fg">Projects</h2>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="text-[10px] text-accent hover:text-accent-hover"
            >
              View all
            </button>
          </div>
          <div className="rounded-lg border border-border divide-y divide-border/30">
            {projects.length === 0 ? (
              <div className="py-8 text-center">
                <FolderOpen size={24} className="mx-auto mb-2 text-fg-faint" />
                <p className="text-xs text-fg-muted">No projects yet</p>
                <button
                  type="button"
                  onClick={onNewProject}
                  className="mt-2 text-xs text-accent hover:text-accent-hover"
                >
                  Create your first project
                </button>
              </div>
            ) : (
              projects.slice(0, 5).map((project) => (
                <ProjectHealthRow
                  key={project.id}
                  project={project}
                  runtime={runtime}
                  onSelect={() => onSelectProject(project)}
                />
              ))
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-xs font-semibold text-fg mb-2">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'New Project', icon: FolderOpen, action: onNewProject },
              { label: 'Open Terminal', icon: Terminal, action: () => onNavigate('terminal') },
              { label: 'View Changes', icon: GitBranch, action: () => onNavigate('changes') },
              { label: 'Environment', icon: Activity, action: () => onNavigate('environment') },
            ].map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5 text-left text-xs text-fg transition-colors hover:bg-surface-hover"
              >
                <Icon size={13} className="text-fg-faint" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
