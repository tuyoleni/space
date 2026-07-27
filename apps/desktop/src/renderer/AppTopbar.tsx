import { useCallback, useEffect, useState } from 'react';
import { Bot, Hexagon, Layers, Loader2, MonitorDot, Plug, Unplug } from 'lucide-react';
import type { AiToolConnection, AiToolsStatus, EnvironmentScanResult, GitRefEntry, GitStatusSummary, GithubAuthReport, Project, WorkspaceSummary } from '@space/contracts';
import { StatusDot, TopbarMenu, useToast } from '@space/ui';
import { BranchMenu } from './BranchMenu';
import { AiToolIcon } from './brand-icons';

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
  readonly branchesInUseElsewhere: ReadonlySet<string>;
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
  branchesInUseElsewhere,
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
          branchesInUseElsewhere={branchesInUseElsewhere}
        />
        <TopbarMenu
          label="Runtime"
          value={nodeTool?.found ? `Node ${nodeTool.version ?? '?'}` : 'Node not found'}
          icon={<Hexagon size={13} className="text-success" />}
        />
        <TopbarMenu label="Environment" value="local" icon={<MonitorDot size={13} className="text-fg-muted" />} />
        <AiToolsConnectionMenu />
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

function DeveloperToolIcon({ tool, size = 14 }: { readonly tool: AiToolConnection; readonly size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[4px] bg-white p-px shadow-sm" style={{ width: size + 2, height: size + 2 }}>
      <AiToolIcon toolId={tool.id} iconDataUrl={tool.iconDataUrl} size={size} />
    </span>
  );
}

function AiToolsConnectionMenu() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiToolsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.space.aiTools.status());
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tools = status?.tools ?? [];
  const connectedTools = tools.filter((tool) => tool.connected);
  const verifiedTools = tools.filter((tool) => tool.verified);
  const serverEnabled = status?.server.enabled ?? false;
  const allConnected = tools.length > 0 && verifiedTools.length === tools.length && serverEnabled;

  async function handleAction(action: string): Promise<void> {
    setBusy(true);
    try {
      if (action === 'connect-all') {
        for (const tool of tools.filter((candidate) => !candidate.connected)) {
          // The first connection may start the shared MCP server.
          // eslint-disable-next-line no-await-in-loop
          await window.space.aiTools.connect({ tool: tool.id });
        }
        toast({ variant: 'success', message: 'All developer tools are connected to Space. Restart open tools to load the Space tools.' });
      } else if (action === 'enable') {
        await window.space.aiTools.setServerEnabled({ enabled: true });
        toast({ variant: 'success', message: 'Space MCP server is running.' });
      } else {
        const [operation, toolId] = action.split(':');
        const tool = tools.find((candidate) => candidate.id === toolId);
        if (!tool) {
          throw new Error('That developer tool is no longer available.');
        }
        if (operation === 'connect') {
          await window.space.aiTools.connect({ tool: tool.id });
          toast({ variant: 'success', message: `${tool.displayName} connected to Space. Restart it to load the Space tools.` });
        } else {
          await window.space.aiTools.disconnect({ tool: tool.id });
          toast({ variant: 'success', message: `${tool.displayName} disconnected from Space.` });
        }
      }
      await refresh();
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  }

  const value = status === null
    ? 'Checking…'
    : connectedTools.length > 0 && !serverEnabled
      ? 'Server off'
      : `${verifiedTools.length}/${tools.length} ready`;
  const options = [
    ...(tools.some((tool) => !tool.connected) ? [{ value: 'connect-all', label: 'Connect all tools' }] : []),
    ...(connectedTools.length > 0 && !serverEnabled ? [{ value: 'enable', label: 'Turn on Space MCP' }] : []),
    ...tools.map((tool) => ({
      value: `${tool.connected ? 'disconnect' : 'connect'}:${tool.id}`,
      label: tool.displayName,
      icon: <DeveloperToolIcon tool={tool} size={16} />,
      trailingIcon: tool.connected
        ? <Unplug size={14} className="text-fg-muted" aria-hidden />
        : <Plug size={14} className="text-success" aria-hidden />,
      ariaLabel: `${tool.connected ? 'Disconnect' : 'Connect'} ${tool.displayName}`,
    })),
  ];

  const toolIcons = tools.slice(0, 4);

  return (
    <TopbarMenu
      label="Developer tools"
      value={busy ? 'Working…' : value}
      icon={busy ? (
        <Loader2 size={13} className="animate-spin text-fg-muted" />
      ) : (
        <span className="flex -space-x-1" aria-hidden>
          {toolIcons.map((tool) => <DeveloperToolIcon key={tool.id} tool={tool} size={13} />)}
          {toolIcons.length === 0 && <Bot size={13} className={allConnected ? 'text-success' : 'text-fg-muted'} />}
        </span>
      )}
      options={options}
      onSelect={(action) => void handleAction(action)}
      disabled={busy || status === null}
    />
  );
}
