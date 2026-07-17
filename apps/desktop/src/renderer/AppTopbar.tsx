import { Hexagon, Layers, Loader2, MonitorDot } from 'lucide-react';
import type { EnvironmentScanResult, GitRefEntry, GitStatusSummary, GithubAuthReport, Project, WorkspaceSummary } from '@space/contracts';
import { StatusDot, TopbarMenu } from '@space/ui';
import { BranchMenu } from './BranchMenu';

interface AppTopbarProps {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeWorkspace: WorkspaceSummary | null;
  readonly projects: readonly Project[];
  readonly selectedProject: Project | null;
  readonly gitStatus: GitStatusSummary | null;
  readonly envScan: EnvironmentScanResult | null;
  readonly githubReport: GithubAuthReport | null;
  readonly githubBusy: boolean;
  readonly onGithubSignIn: () => void;
  readonly onGithubSignOut: () => void;
  readonly busy: boolean;
  readonly onActivateWorkspace: (workspaceId: string) => void;
  readonly onSelectProject: (projectId: string) => void;
  readonly onSwitchBranch: (branchName: string) => void;
  readonly onCreateBranch: (name: string) => void;
  readonly onFetch: () => void;
  readonly onPush: () => void;
  readonly branches: readonly GitRefEntry[];
}

const GITHUB_SIGN_IN_OPTION = { value: 'sign-in', label: 'Sign in…' };
const GITHUB_SIGN_OUT_OPTION = { value: 'sign-out', label: 'Sign out' };

export function AppTopbar({
  workspaces,
  activeWorkspace,
  projects,
  selectedProject,
  gitStatus,
  envScan,
  githubReport,
  githubBusy,
  onGithubSignIn,
  onGithubSignOut,
  busy,
  onActivateWorkspace,
  onSelectProject,
  onSwitchBranch,
  onCreateBranch,
  onFetch,
  onPush,
  branches,
}: AppTopbarProps) {
  const nodeTool = envScan?.tools.find((tool) => tool.toolId === 'node');
  const branchName = gitStatus?.branch.detached ? '(detached)' : gitStatus?.branch.branchName ?? '—';
  const githubConnected = Boolean(githubReport?.authenticated);

  return (
    <header className="space-titlebar-drag flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-app-bg p-2">
      <div className="space-titlebar-no-drag flex min-w-0 items-center gap-2 overflow-x-auto">
        <TopbarMenu
          label="Workspace"
          value={activeWorkspace?.name ?? '—'}
          icon={<Layers size={13} className="text-accent" />}
          options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
          onSelect={onActivateWorkspace}
          disabled={busy}
        />
        <TopbarMenu
          label="Project"
          value={selectedProject?.name ?? 'Select…'}
          icon={selectedProject ? <StatusDot tone="success" /> : undefined}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onSelect={onSelectProject}
          disabled={busy}
        />
        <BranchMenu
          branches={branches}
          currentBranch={branchName}
          disabled={busy || !selectedProject}
          onSwitch={onSwitchBranch}
          onCreate={onCreateBranch}
          onFetch={onFetch}
          onPush={onPush}
        />
        <TopbarMenu
          label="Runtime"
          value={nodeTool?.found ? `Node ${nodeTool.version ?? '?'}` : 'Node not found'}
          icon={<Hexagon size={13} className="text-success" />}
        />
        <TopbarMenu label="Environment" value="local" icon={<MonitorDot size={13} className="text-fg-muted" />} />
        <TopbarMenu
          label="GitHub"
          value={githubConnected && githubReport?.activeAccount ? githubReport.activeAccount.account : 'Not connected'}
          icon={<StatusDot tone={githubConnected ? 'success' : 'neutral'} />}
          options={[githubConnected ? GITHUB_SIGN_OUT_OPTION : GITHUB_SIGN_IN_OPTION]}
          onSelect={(value) => (value === 'sign-in' ? onGithubSignIn() : onGithubSignOut())}
          disabled={githubBusy || !activeWorkspace}
        />
      </div>
      <div className="space-titlebar-no-drag flex shrink-0 items-center gap-2 pr-1">
        {busy && <Loader2 size={14} className="animate-spin text-fg-muted" aria-label="Working" />}
        {envScan?.gitUserName && (
          <span
            aria-label={`Signed in to git as ${envScan.gitUserName}`}
            title={envScan.gitUserName}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-fg"
          >
            {envScan.gitUserName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
        )}
      </div>
    </header>
  );
}
