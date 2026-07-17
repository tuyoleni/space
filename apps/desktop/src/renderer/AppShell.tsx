import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DevProcessInfo,
  EnvironmentScanResult,
  GitRefEntry,
  MenuCommand,
  GitStatusSummary,
  Project,
  ProjectDetectionReport,
  ProjectTemplateSummary,
  ServiceInfo,
  TerminalSessionInfo,
  TrustDecision,
  WorkspaceSummary,
} from '@space/contracts';
import { Dialog, InlineBanner, useToast } from '@space/ui';
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
import { CloneProjectDialog, CreateProjectDialog } from './views/ProjectDialogs';
import { OnboardingWizard } from './OnboardingWizard';
import { GithubSetupPrompt } from './GithubSetupPrompt';
import { useGithubAuth } from './useGithubAuth';
import { GithubAuthControls } from './GithubAuthControls';

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
  const { toast } = useToast();
  const [envScan, setEnvScan] = useState<EnvironmentScanResult | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);
  const [branches, setBranches] = useState<readonly GitRefEntry[]>([]);
  const [terminalCount, setTerminalCount] = useState(0);

  const [runtime, setRuntime] = useState<ProjectRuntimeState>({ detections: {}, devServers: {}, services: {}, openTerminal: {} });

  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [githubSetupProject, setGithubSetupProject] = useState<Project | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.space.workspace.list());
  }, []);

  const [storageDegraded, setStorageDegraded] = useState(false);
  // Distinct from `workspaces.length === 0`: that's also true for a split
  // second on every launch before the real list arrives. The onboarding
  // wizard must only ever judge "zero workspaces" once this is true —
  // otherwise every returning user would see it flash on startup.
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

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
          setWorkspacesLoaded(true);
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
      return;
    }
    try {
      const [status, refs] = await Promise.all([
        window.space.git.status({ projectId: selectedProject.id }),
        window.space.git.listBranches({ projectId: selectedProject.id }),
      ]);
      setGitStatus(status);
      setBranches(refs);
    } catch {
      setGitStatus(null);
      setBranches([]);
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

  async function runGuarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  function selectProject(projectId: string): void {
    setSelectedProjectId(projectId);
    void window.space.project.opened(projectId).catch(() => undefined);
  }

  function handleCreateWorkspace(name: string): void {
    void runGuarded(async () => {
      await window.space.workspace.create({ name });
      await refreshWorkspaces();
    });
  }

  function handleActivateWorkspace(workspaceId: string): void {
    void runGuarded(async () => {
      await window.space.workspace.activate(workspaceId);
      await refreshWorkspaces();
    });
  }

  function handleSwitchBranch(branchName: string): void {
    if (!selectedProject) {
      return;
    }
    const projectId = selectedProject.id;
    void runGuarded(async () => {
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
    void runGuarded(async () => {
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
    void runGuarded(async () => {
      await window.space.git.fetch({ projectId });
      await refreshGitContext();
      toast({ variant: 'success', message: 'Fetched from remote.' });
    });
  }

  function handlePush(): void {
    if (!selectedProject || !gitStatus?.branch.branchName) {
      return;
    }
    const projectId = selectedProject.id;
    const branch = gitStatus.branch.branchName;
    const setUpstream = !gitStatus.branch.upstream;
    void runGuarded(async () => {
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
    void runGuarded(async () => {
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

  function handleCreateProject(templateId: string, name: string): void {
    if (!activeWorkspace || !templateId || !name.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    const template = templates.find((candidate) => candidate.id === templateId);
    void runGuarded(async () => {
      const destinationParentDirectory = await window.space.project.pickParentDirectory();
      if (!destinationParentDirectory) {
        return;
      }
      const project = await window.space.project.createFromTemplate({
        workspaceId,
        templateId,
        destinationParentDirectory,
        name: name.trim(),
      });
      await refreshProjects(workspaceId);
      toast({ variant: 'success', message: `Created "${project.name}" using ${template?.displayName ?? templateId} at ${project.canonicalPath}.` });
      await offerGithubSetupIfNeeded(project);
    });
  }

  function handleCloneProject(url: string, name: string): void {
    if (!activeWorkspace || !url.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded(async () => {
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
      void runGuarded(async () => {
        const report = await window.space.project.detect({ canonicalPath: project.canonicalPath });
        setRuntime((prev) => ({ ...prev, detections: { ...prev.detections, [project.id]: report } }));
      });
    },
    trustDecision(project, decision) {
      void runGuarded(async () => {
        await window.space.project.trustDecision({ projectId: project.id, decision });
        if (activeWorkspaceId) {
          await refreshProjects(activeWorkspaceId);
        }
      });
    },
    install(project, allowOnce) {
      void runGuarded(async () => {
        const result = await window.space.project.installDependencies({ projectId: project.id, allowOnce });
        toast(
          result.succeeded
            ? { variant: 'success', message: `Installed dependencies with ${result.packageManager}.` }
            : { variant: 'error', message: `Install with ${result.packageManager} failed (exit ${result.exitCode ?? 'unknown'}).` },
        );
      });
    },
    update(project, allowOnce) {
      void runGuarded(async () => {
        const result = await window.space.project.updateDependencies({ projectId: project.id, allowOnce });
        toast(
          result.succeeded
            ? { variant: 'success', message: `Updated dependencies with ${result.packageManager}.` }
            : { variant: 'error', message: `Update with ${result.packageManager} failed (exit ${result.exitCode ?? 'unknown'}).` },
        );
      });
    },
    startDevServer(project, allowOnce) {
      void runGuarded(async () => {
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
      void runGuarded(async () => {
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
      void runGuarded(async () => {
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
      void runGuarded(async () => {
        const session = await window.space.terminal.create({ workspaceId, projectId: project.id, cols: 100, rows: 28 });
        setRuntime((prev) => ({ ...prev, openTerminal: { ...prev.openTerminal, [project.id]: session } }));
        await refreshTerminalCount(workspaceId);
      });
    },
    closeTerminal(project) {
      const session = runtime.openTerminal[project.id];
      if (!session || !activeWorkspaceId) {
        return;
      }
      const workspaceId = activeWorkspaceId;
      void runGuarded(async () => {
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
              <ChangesView workspace={activeWorkspace} project={selectedProject} />
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

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} templates={templates} onCreate={handleCreateProject} />
      <CloneProjectDialog open={cloneOpen} onOpenChange={setCloneOpen} onClone={handleCloneProject} />

      <Dialog
        open={Boolean(githubAuth.loginSession)}
        onOpenChange={(open) => !open && githubAuth.dismissLogin()}
        title="Sign in to GitHub"
        size="lg"
      >
        <GithubAuthControls
          report={githubAuth.report}
          loginSession={githubAuth.loginSession}
          busy={githubAuth.busy}
          onRefresh={() => void githubAuth.refreshReport()}
          onSignIn={githubAuth.signIn}
          onSignOut={githubAuth.signOut}
        />
      </Dialog>

      {/* First-run only: the real workspace list has loaded (not just the
          pre-load empty array) and it's genuinely zero — never flash this
          on a normal launch, and never layer it over the "storage is
          starting up" retry banner above. */}
      {workspacesLoaded && workspaces.length === 0 && !storageDegraded && !onboardingDismissed && (
        <OnboardingWizard onCreateWorkspace={handleCreateWorkspace} onDismiss={() => setOnboardingDismissed(true)} />
      )}

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
