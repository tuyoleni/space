import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DevProcessInfo,
  EnvironmentScanResult,
  GitRefEntry,
  MenuCommand,
  GitStatusSummary,
  Project,
  ProjectDetectionReport,
  ProjectIssue,
  ProjectTemplateSummary,
  ServiceInfo,
  TerminalSessionInfo,
  TrustDecision,
  WorkspaceSummary,
} from '@space/contracts';
import { Button, Dialog, InlineBanner, useToast } from '@space/ui';
import { toErrorMessage } from './errors';
import { Sidebar } from './Sidebar';
import { AppTopbar } from './AppTopbar';
import { StatusBar } from './StatusBar';
import type { NavView } from './nav';
import { HomeView } from './views/HomeView';
import { ChangesView } from './views/ChangesView';
import { TerminalsView } from './views/TerminalsView';
import { EnvironmentView } from './views/EnvironmentView';
import { ProjectsView } from './views/ProjectsView';
import { SystemView } from './views/SystemView';
import { ProjectIssueDialog } from './ProjectIssueDialog';
import { CloneProjectDialog, CreateProjectDialog, type CreateProjectRequest } from './views/ProjectDialogs';
import { GithubSetupPrompt } from './GithubSetupPrompt';
import { useGithubAuth } from './useGithubAuth';
import { GithubAuthDialog } from './GithubAuthDialog';

export interface ProjectRuntimeState {
  readonly detections: Record<string, ProjectDetectionReport>;
  readonly devServers: Record<string, DevProcessInfo[]>;
  readonly services: Record<string, ServiceInfo[]>;
  readonly openTerminal: Record<string, TerminalSessionInfo>;
}

export interface ProjectActions {
  readonly selectProject: (project: Project) => void;
  readonly detect: (project: Project) => void;
  readonly trustDecision: (project: Project, decision: TrustDecision) => void;
  readonly install: (project: Project, allowOnce: boolean) => void;
  readonly update: (project: Project, allowOnce: boolean) => void;
  readonly startDevServer: (project: Project, allowOnce: boolean) => void;
  readonly stopDevServer: (project: Project, devProcessId: string) => void;
  readonly stopService: (project: Project, service: ServiceInfo) => void;
  readonly openTerminal: (project: Project) => void;
  readonly runScript: (project: Project, scriptName: string) => void;
  readonly closeTerminal: (project: Project) => void;
}

export function AppShell() {
  const [view, setView] = useState<NavView>('home');
  // Environment does real, non-trivial work on mount (Homebrew/npm scans,
  // network icon fetches) — mount it lazily on first visit rather than
  // eagerly at startup like Terminal does, but once mounted keep it alive
  // (see the render below) so later visits don't pay that cost again.
  const [hasVisitedEnvironment, setHasVisitedEnvironment] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Working…');
  const { toast } = useToast();
  const [envScan, setEnvScan] = useState<EnvironmentScanResult | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);
  const [branches, setBranches] = useState<readonly GitRefEntry[]>([]);
  /** Local branch refnames checked out by another linked worktree — `git switch` refuses these, so the branch menu disables them instead of letting the user hit a raw error. */
  const [branchesInUseElsewhere, setBranchesInUseElsewhere] = useState<ReadonlySet<string>>(new Set());
  const [terminalCount, setTerminalCount] = useState(0);

  const [runtime, setRuntime] = useState<ProjectRuntimeState>({ detections: {}, devServers: {}, services: {}, openTerminal: {} });

  const [createOpen, setCreateOpen] = useState(false);
  // The blocking precondition a user hit, shown as a resolvable dialog
  // rather than the underlying command's stderr.
  const [projectIssue, setProjectIssue] = useState<ProjectIssue | null>(null);
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<Project | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [githubSetupProject, setGithubSetupProject] = useState<Project | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.space.workspace.list());
  }, []);

  const [storageDegraded, setStorageDegraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The storage worker can still be booting (or recovering from a
    // crash-respawn) when the renderer first loads — keep retrying rather
    // than ever rendering a permanently dead shell. The banner below tells
    // the user what's happening while it recovers.
    async function loadInitial(): Promise<void> {
      for (let attempt = 0; !cancelled; attempt += 1) {
        try {
          await refreshWorkspaces();
          setTemplates(await window.space.project.listTemplates());
          setStorageDegraded(false);
          return;
        } catch {
          if (attempt >= 1) {
            setStorageDegraded(true);
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 1_000 * (attempt + 1))));
        }
      }
    }
    void loadInitial();
    // One real machine scan at startup — refreshed on demand from the
    // Environment view, not on a timer.
    void window.space.environment.scan({}).then(setEnvScan, () => setEnvScan(null));
    return () => {
      cancelled = true;
    };
  }, [refreshWorkspaces]);

  const activeWorkspace = workspaces.find((workspace) => workspace.active) ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  // GitHub connection status lives in the header (AppTopbar), not a
  // standalone dashboard card — this is the one place that owns it, shared
  // with HomeView and EnvironmentView's read-only displays.
  const githubAuth = useGithubAuth(activeWorkspaceId ?? '');

  const refreshProjects = useCallback(async (workspaceId: string) => {
    const list = await window.space.project.list(workspaceId);
    setProjects(list);
    setSelectedProjectId((current) => current && list.some((p) => p.id === current) ? current : list[0]?.id ?? null);
  }, []);

  const refreshTerminalCount = useCallback(async (workspaceId: string) => {
    const sessions = await window.space.terminal.list(workspaceId);
    setTerminalCount(sessions.filter((session) => session.state === 'running').length);
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      void refreshProjects(activeWorkspaceId);
      void refreshTerminalCount(activeWorkspaceId);
    } else {
      setProjects([]);
      setTerminalCount(0);
    }
  }, [activeWorkspaceId, refreshProjects, refreshTerminalCount]);

  // Git context for the selected project: status (changes badge, topbar
  // branch, status bar) + local branch list (topbar switcher). Re-read on
  // selection and whenever the user lands somewhere it is shown.
  const refreshGitContext = useCallback(async () => {
    if (!selectedProject?.repositoryRoot) {
      setGitStatus(null);
      setBranches([]);
      setBranchesInUseElsewhere(new Set());
      return;
    }
    try {
      const [status, refs, worktrees] = await Promise.all([
        window.space.git.status({ projectId: selectedProject.id }),
        window.space.git.listBranches({ projectId: selectedProject.id }),
        window.space.git.listWorktrees({ projectId: selectedProject.id }),
      ]);
      setGitStatus(status);
      setBranches(refs);
      setBranchesInUseElsewhere(
        new Set(worktrees.filter((wt) => !wt.isCurrent && wt.branch).map((wt) => wt.branch as string)),
      );
    } catch {
      setGitStatus(null);
      setBranches([]);
      setBranchesInUseElsewhere(new Set());
    }
  }, [selectedProject?.id, selectedProject?.repositoryRoot]);

  useEffect(() => {
    void refreshGitContext();
  }, [refreshGitContext, view]);

  useEffect(() => {
    if (view === 'environment') {
      setHasVisitedEnvironment(true);
    }
  }, [view]);

  useEffect(() => {
    if (activeWorkspaceId) {
      void refreshTerminalCount(activeWorkspaceId);
    }
  }, [activeWorkspaceId, refreshTerminalCount, view]);

  async function runGuarded(message: string, action: () => Promise<void>): Promise<void> {
    setBusyMessage(message);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
      setBusyMessage('Working…');
    }
  }

  function selectProject(projectId: string): void {
    setSelectedProjectId(projectId);
    void window.space.project.opened(projectId).catch(() => undefined);
  }

  function handleCreateWorkspace(name: string): void {
    void runGuarded('Creating workspace…', async () => {
      await window.space.workspace.create({ name });
      await refreshWorkspaces();
    });
  }

  function handleActivateWorkspace(workspaceId: string): void {
    void runGuarded('Switching workspace…', async () => {
      await window.space.workspace.activate(workspaceId);
      await refreshWorkspaces();
    });
  }

  function handleSwitchBranch(branchName: string): void {
    if (!selectedProject) {
      return;
    }
    const projectId = selectedProject.id;
    void runGuarded('Switching branch…', async () => {
      // `branchName` is a full refname (refs/heads/… or refs/remotes/…);
      // the engine normalizes it to the switch target (and DWIMs a tracking
      // branch for a remote), so it is passed through as-is here.
      await window.space.git.switchBranch({ projectId, name: branchName });
      await refreshGitContext();
    });
  }

  function handleCreateBranch(name: string): void {
    if (!selectedProject || !name.trim()) {
      return;
    }
    const projectId = selectedProject.id;
    void runGuarded('Creating branch…', async () => {
      await window.space.git.createBranch({ projectId, name: name.trim() });
      await window.space.git.switchBranch({ projectId, name: name.trim() });
      await refreshGitContext();
      toast({ variant: 'success', message: `Created and switched to branch "${name.trim()}".` });
    });
  }

  function handleFetch(): void {
    if (!selectedProject) {
      return;
    }
    const projectId = selectedProject.id;
    void runGuarded('Fetching from remote…', async () => {
      await window.space.git.fetch({ projectId });
      await refreshGitContext();
      toast({ variant: 'success', message: 'Fetched from remote.' });
    });
  }

  /**
   * Pushing checks its own preconditions first. Without this, a project with
   * no remote produced `fatal: 'origin' does not appear to be a git
   * repository` — the real CLI's real message, shown to someone who has
   * never configured a remote and cannot act on it. The blocking issue is
   * knowable beforehand, so the user gets a dialog with the fix instead.
   */
  function handlePush(): void {
    if (!selectedProject || !gitStatus?.branch.branchName) {
      return;
    }
    const projectId = selectedProject.id;
    const branch = gitStatus.branch.branchName;
    const setUpstream = !gitStatus.branch.upstream;
    void runGuarded('Pushing to remote…', async () => {
      const diagnosis = await window.space.project.diagnose({ projectId, action: 'push' });
      if (diagnosis.blocking) {
        setProjectIssue(diagnosis.blocking);
        return;
      }
      await window.space.git.push({ projectId, branch, setUpstream });
      await refreshGitContext();
      toast({ variant: 'success', message: `Pushed ${branch}${setUpstream ? ' (set upstream)' : ''}.` });
    });
  }

  /**
   * Offers the GitHub setup prompt whenever a project has no remote at all
   * — either because it isn't a Git repository yet (`!repositoryRoot`), or
   * because it is one but was never published (many project-template
   * scaffolders, e.g. create-vite/create-next-app, already run `git init`
   * themselves, so `repositoryRoot` alone isn't a reliable "needs setup"
   * signal — the real question is whether it has a remote).
   */
  async function offerGithubSetupIfNeeded(project: Project): Promise<void> {
    if (!project.repositoryRoot) {
      setGithubSetupProject(project);
      return;
    }
    const remotes = await window.space.git.listRemotes({ projectId: project.id }).catch(() => []);
    if (remotes.length === 0) {
      setGithubSetupProject(project);
    }
  }

  function handleAddFolder(): void {
    if (!activeWorkspace) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded('Adding folder…', async () => {
      const picked = await window.space.project.pickFolder();
      if (!picked) {
        return;
      }
      const inspection = await window.space.project.inspectFolder({ path: picked });
      if (!inspection.exists || !inspection.isDirectory) {
        throw new Error(`"${inspection.path}" is not an accessible directory`);
      }
      if (inspection.alreadyRegisteredInWorkspaceId) {
        throw new Error(`"${inspection.path}" is already registered in another workspace`);
      }
      const project = await window.space.project.add({ workspaceId, canonicalPath: inspection.path });
      await refreshProjects(workspaceId);
      await offerGithubSetupIfNeeded(project);
    });
  }

  function handleRemoveProject(): void {
    const project = projectPendingRemoval;
    if (!project || !activeWorkspace) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded('Removing project from Space…', async () => {
      const result = await window.space.project.remove({ projectId: project.id });
      setProjectPendingRemoval(null);
      await refreshProjects(workspaceId);
      toast({
        variant: 'success',
        message: `Removed "${result.name}" from Space. Your files are still at ${result.canonicalPath}.`,
      });
    });
  }

  function handleCreateProject(request: CreateProjectRequest): void {
    if (!activeWorkspace || !request.templateId || !request.name.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    const template = templates.find((candidate) => candidate.id === request.templateId);
    void runGuarded(`Creating ${request.name.trim()}…`, async () => {
      const destinationParentDirectory = await window.space.project.pickParentDirectory();
      if (!destinationParentDirectory) {
        return;
      }
      const result = await window.space.project.createFromTemplate({
        workspaceId,
        templateId: request.templateId,
        destinationParentDirectory,
        name: request.name.trim(),
        initializeGit: request.initializeGit,
        ...(request.publishToGithub ? { publishToGithub: request.publishToGithub } : {}),
      });
      await refreshProjects(workspaceId);

      const { project, github, warnings } = result;
      const scaffolded = `Created "${project.name}" using ${template?.displayName ?? request.templateId} at ${project.canonicalPath}.`;
      toast({
        variant: 'success',
        message: github ? `${scaffolded} Published to ${github.nameWithOwner}.` : scaffolded,
      });

      // The project exists either way; a failed follow-on step is reported
      // as its own message rather than being folded into the success toast
      // or swallowed.
      for (const warning of warnings) {
        toast({ variant: 'error', message: warning });
      }

      // Only nudge toward GitHub setup when we haven't just published there.
      if (!github) {
        await offerGithubSetupIfNeeded(project);
      }
    });
  }

  function handleCloneProject(url: string, name: string): void {
    if (!activeWorkspace || !url.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded('Cloning repository…', async () => {
      const destinationParentDirectory = await window.space.project.pickParentDirectory();
      if (!destinationParentDirectory) {
        return;
      }
      const project = await window.space.project.clone({
        workspaceId,
        remoteUrl: url.trim(),
        destinationParentDirectory,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      await refreshProjects(workspaceId);
      toast({ variant: 'success', message: `Cloned "${project.name}" from ${url.trim()} to ${project.canonicalPath}.` });
    });
  }

  const actions: ProjectActions = {
    selectProject(project) {
      selectProject(project.id);
    },
    detect(project) {
      void runGuarded(`Inspecting ${project.name}…`, async () => {
        const report = await window.space.project.detect({ canonicalPath: project.canonicalPath });
        setRuntime((prev) => ({ ...prev, detections: { ...prev.detections, [project.id]: report } }));
      });
    },
    trustDecision(project, decision) {
      void runGuarded(`Updating trust for ${project.name}…`, async () => {
        await window.space.project.trustDecision({ projectId: project.id, decision });
        if (activeWorkspaceId) {
          await refreshProjects(activeWorkspaceId);
        }
      });
    },
    install(project, allowOnce) {
      void runGuarded(`Installing dependencies for ${project.name}…`, async () => {
        const result = await window.space.project.installDependencies({ projectId: project.id, allowOnce });
        toast(
          result.succeeded
            ? { variant: 'success', message: `Installed dependencies with ${result.packageManager}.` }
            : { variant: 'error', message: `Install with ${result.packageManager} failed (exit ${result.exitCode ?? 'unknown'}).` },
        );
      });
    },
    update(project, allowOnce) {
      void runGuarded(`Updating dependencies for ${project.name}…`, async () => {
        const result = await window.space.project.updateDependencies({ projectId: project.id, allowOnce });
        toast(
          result.succeeded
            ? { variant: 'success', message: `Updated dependencies with ${result.packageManager}.` }
            : { variant: 'error', message: `Update with ${result.packageManager} failed (exit ${result.exitCode ?? 'unknown'}).` },
        );
      });
    },
    startDevServer(project, allowOnce) {
      void runGuarded(`Starting ${project.name}…`, async () => {
        await window.space.devServer.start({ projectId: project.id, allowOnce });
        const [list, services] = await Promise.all([window.space.devServer.list(project.id), window.space.services.list(project.id)]);
        setRuntime((prev) => ({
          ...prev,
          devServers: { ...prev.devServers, [project.id]: list },
          services: { ...prev.services, [project.id]: services },
        }));
      });
    },
    stopDevServer(project, devProcessId) {
      void runGuarded(`Stopping ${project.name}…`, async () => {
        await window.space.devServer.stop({ devProcessId });
        const [list, services] = await Promise.all([window.space.devServer.list(project.id), window.space.services.list(project.id)]);
        setRuntime((prev) => ({
          ...prev,
          devServers: { ...prev.devServers, [project.id]: list },
          services: { ...prev.services, [project.id]: services },
        }));
      });
    },
    stopService(project, service) {
      void runGuarded(`Stopping ${service.label}…`, async () => {
        await window.space.services.stop({ id: service.id, kind: service.kind });
        const [list, services] = await Promise.all([window.space.devServer.list(project.id), window.space.services.list(project.id)]);
        setRuntime((prev) => ({
          ...prev,
          devServers: { ...prev.devServers, [project.id]: list },
          services: { ...prev.services, [project.id]: services },
        }));
      });
    },
    openTerminal(project) {
      if (!activeWorkspace) {
        return;
      }
      const workspaceId = activeWorkspace.id;
      void runGuarded(`Opening terminal for ${project.name}…`, async () => {
        const session = await window.space.terminal.create({ workspaceId, projectId: project.id, cols: 100, rows: 28 });
        setRuntime((prev) => ({ ...prev, openTerminal: { ...prev.openTerminal, [project.id]: session } }));
        await refreshTerminalCount(workspaceId);
      });
    },
    runScript(project, scriptName) {
      if (!activeWorkspace) {
        return;
      }
      const workspaceId = activeWorkspace.id;
      void runGuarded(`Running ${scriptName}…`, async () => {
        const environment = await window.space.project.environmentInfo({ projectId: project.id });
        if (!environment.scriptNames.includes(scriptName)) {
          throw new Error(`The script "${scriptName}" is no longer available in ${project.name}.`);
        }
        const packageManager = environment.packageManager ?? 'npm';
        const session = await window.space.terminal.create({ workspaceId, projectId: project.id, cols: 100, rows: 28 });
        await window.space.terminal.write({ sessionId: session.id, data: `${packageManager} run ${scriptName}\r` });
        setRuntime((prev) => ({ ...prev, openTerminal: { ...prev.openTerminal, [project.id]: session } }));
        await refreshTerminalCount(workspaceId);
        setView('terminal');
      });
    },
    closeTerminal(project) {
      const session = runtime.openTerminal[project.id];
      if (!session || !activeWorkspaceId) {
        return;
      }
      const workspaceId = activeWorkspaceId;
      void runGuarded(`Closing terminal for ${project.name}…`, async () => {
        await window.space.terminal.dispose({ sessionId: session.id });
        setRuntime((prev) => {
          const next = { ...prev.openTerminal };
          delete next[project.id];
          return { ...prev, openTerminal: next };
        });
        await refreshTerminalCount(workspaceId);
      });
    },
  };

  useEffect(() => {
    for (const project of projects) {
      void window.space.devServer.list(project.id).then((list) => {
        setRuntime((prev) => ({ ...prev, devServers: { ...prev.devServers, [project.id]: list } }));
      });
      void window.space.services.list(project.id).then((services) => {
        setRuntime((prev) => ({ ...prev, services: { ...prev.services, [project.id]: services } }));
      });
    }
    // Refresh dev-server/service state whenever the project list for the
    // active workspace changes — not on every `runtime` update (which this
    // effect itself causes), so it deliberately depends only on `projects`.
  }, [projects]);

  const runningProjectIds = new Set(
    projects.filter((project) => (runtime.devServers[project.id] ?? []).some((server) => server.state === 'running')).map((p) => p.id),
  );
  const changedFileCount = gitStatus ? gitStatus.entries.filter((entry) => entry.kind !== 'ignored').length : 0;

  // Native menu (app-menu.ts) commands route to the same handlers the in-app
  // controls use. A ref holds the latest dispatcher so the one-time
  // subscription never captures stale handlers.
  const menuDispatch = useRef<(command: MenuCommand) => void>(() => undefined);
  menuDispatch.current = (command) => {
    switch (command) {
      case 'new-project':
        setCreateOpen(true);
        break;
      case 'add-folder':
        handleAddFolder();
        break;
      case 'clone':
        setCloneOpen(true);
        break;
      case 'new-terminal':
        setView('terminal');
        break;
      case 'go-home':
        setView('home');
        break;
      case 'go-changes':
        setView('changes');
        break;
      case 'go-history':
        setView('changes');
        break;
      case 'go-terminal':
        setView('terminal');
        break;
      case 'go-environment':
        setView('environment');
        break;
      case 'git-fetch':
        handleFetch();
        break;
      case 'git-push':
        handlePush();
        break;
    }
  };
  useEffect(() => window.space.menu.onCommand((command) => menuDispatch.current(command)), []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app-bg text-fg">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          projects={projects}
          selectedProjectId={selectedProjectId}
          runningProjectIds={runningProjectIds}
          changedFileCount={changedFileCount}
          terminalCount={terminalCount}
          diskFreeBytes={envScan?.diskFreeBytes ?? null}
          busy={busy}
          view={view}
          onNavigate={setView}
          onSelectProject={selectProject}
          onRemoveProject={setProjectPendingRemoval}
          onActivateWorkspace={handleActivateWorkspace}
          onCreateWorkspace={handleCreateWorkspace}
          onNewProject={() => setCreateOpen(true)}
          onAddFolder={handleAddFolder}
          onCloneRepository={() => setCloneOpen(true)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            projects={projects}
            selectedProject={selectedProject}
            gitStatus={gitStatus}
            envScan={envScan}
            githubReport={githubAuth.report}
            githubBusy={githubAuth.busy}
            onGithubSignIn={githubAuth.signIn}
            onGithubSignOut={githubAuth.signOut}
            busy={busy}
            onActivateWorkspace={handleActivateWorkspace}
            onSelectProject={selectProject}
            onSwitchBranch={handleSwitchBranch}
            onCreateBranch={handleCreateBranch}
            onFetch={handleFetch}
            onPush={handlePush}
            branches={branches}
            branchesInUseElsewhere={branchesInUseElsewhere}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {storageDegraded && (
              <div className="px-6 pt-4">
                <InlineBanner variant="info" className="mb-2">
                  Storage is starting up — retrying automatically&hellip;
                </InlineBanner>
              </div>
            )}

            {/* Terminal stays mounted across navigation (CSS-hidden, not
                unmounted) so its live xterm buffer and PTY subscription
                survive leaving and returning to this view — unmounting it
                on every nav away/back was destroying real scrollback and
                re-printing the session banner as if the shell had died,
                even though the underlying PTY was still running. */}
            {activeWorkspace && (
              <div className={view === 'terminal' ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
                <TerminalsView workspace={activeWorkspace} projects={projects} envScan={envScan} selectedProjectId={selectedProjectId} />
              </div>
            )}

            {/* Same reasoning as Terminal above: Environment does its own real
                Homebrew/npm scans, icon resolution (network favicon fetches),
                and per-project reads — unmounting it on every nav away/back
                re-ran all of that from scratch on every single visit. Kept
                mounted (CSS-hidden) once visited; "Rescan"/actions inside it
                still refresh explicitly, this only stops the implicit
                refetch-on-revisit. */}
            {activeWorkspace && hasVisitedEnvironment && (
              <div className={view === 'environment' ? 'contents' : 'hidden'}>
                <EnvironmentView
                  selectedProjectId={selectedProject?.id ?? null}
                  activeWorkspaceId={activeWorkspace?.id ?? null}
                  githubReport={githubAuth.report}
                  {...(selectedProject ? { onRunScript: (scriptName: string) => actions.runScript(selectedProject, scriptName) } : {})}
                />
              </div>
            )}

            {!activeWorkspace ? (
              <div className="p-6">
                <InlineBanner variant="info">Create or switch to a workspace to get started.</InlineBanner>
              </div>
            ) : view === 'home' ? (
              <HomeView
                workspace={activeWorkspace}
                projects={projects}
                selectedProject={selectedProject}
                gitStatus={gitStatus}
                envScan={envScan}
                githubReport={githubAuth.report}
                runtime={runtime}
                actions={actions}
                busy={busy}
                changedFileCount={changedFileCount}
                onNavigate={setView}
                onNewProject={() => setCreateOpen(true)}
                onAddFolder={handleAddFolder}
                onCloneRepository={() => setCloneOpen(true)}
                onFetch={handleFetch}
                onPush={handlePush}
              />
            ) : view === 'changes' ? (
              <ChangesView
                workspace={activeWorkspace}
                project={selectedProject}
                onProjectChanged={() => refreshProjects(activeWorkspace.id)}
              />
            ) : view === 'terminal' ? null : view === 'environment' ? null : view === 'projects' ? (
              <ProjectsView
                workspace={activeWorkspace}
                projects={projects}
                templates={templates}
                runtime={runtime}
                actions={actions}
                busy={busy}
                selectedProjectId={selectedProjectId}
                onSelectProject={(projectId) => projectId && selectProject(projectId)}
                onAddFolder={handleAddFolder}
                onCreateProject={handleCreateProject}
                onCloneProject={handleCloneProject}
              />
            ) : (
              <SystemView workspace={activeWorkspace} projects={projects} runtime={runtime} actions={actions} busy={busy} />
            )}
          </div>
          <StatusBar
            workspaceName={activeWorkspace?.name ?? null}
            project={selectedProject}
            gitStatus={gitStatus}
            changedFileCount={changedFileCount}
            terminalCount={terminalCount}
            envScan={envScan}
          />
        </div>
      </div>

      <Dialog
        open={projectPendingRemoval !== null}
        onOpenChange={(next) => !next && setProjectPendingRemoval(null)}
        title="Remove project?"
        footer={
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setProjectPendingRemoval(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={handleRemoveProject}>
              Remove project
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Removes <span className="font-medium text-fg">{projectPendingRemoval?.name}</span> from Space only. Your files and Git history stay on this Mac.
          </p>
          <div className="rounded-md bg-surface px-3 py-2" title={projectPendingRemoval?.canonicalPath}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-fg-faint">Folder</p>
            <code className="block truncate pt-0.5 text-xs text-fg-muted">{projectPendingRemoval?.canonicalPath}</code>
          </div>
        </div>
      </Dialog>

      <ProjectIssueDialog
        open={projectIssue !== null}
        onOpenChange={(next) => !next && setProjectIssue(null)}
        issue={projectIssue}
        projectId={selectedProject?.id ?? ''}
        onGithubSignIn={githubAuth.signIn}
        onResolved={async () => {
          if (activeWorkspace) {
            await refreshProjects(activeWorkspace.id);
          }
          await refreshGitContext();
        }}
      />
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        workspaceId={activeWorkspace?.id ?? ''}
        onCreate={handleCreateProject}
      />
      <CloneProjectDialog open={cloneOpen} onOpenChange={setCloneOpen} onClone={handleCloneProject} />

      <Dialog open={busy} onOpenChange={() => undefined} title={busyMessage} dismissible={false}>
        <div className="flex items-center gap-3 text-sm text-fg-muted" role="status" aria-live="polite">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-fg-faint border-t-accent" aria-hidden="true" />
          This can take a moment. Space is still working.
        </div>
      </Dialog>

      <GithubAuthDialog
        open={githubAuth.loginOpen}
        report={githubAuth.report}
        session={githubAuth.loginSession}
        busy={githubAuth.busy}
        onClose={githubAuth.dismissLogin}
        onRefresh={githubAuth.refreshReport}
      />

      {githubSetupProject && activeWorkspaceId && (
        <GithubSetupPrompt
          project={githubSetupProject}
          workspaceId={activeWorkspaceId}
          onDismiss={() => {
            setGithubSetupProject(null);
            void refreshProjects(activeWorkspaceId);
          }}
        />
      )}
    </div>
  );
}
