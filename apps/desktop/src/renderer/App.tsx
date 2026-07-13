import { useCallback, useEffect, useState } from 'react';
import type {
  DevProcessInfo,
  Project,
  ProjectDetectionReport,
  ProjectTemplateSummary,
  TerminalSessionInfo,
  TrustDecision,
  WorkspaceSummary,
} from '@space/contracts';
import { ActivityGrid } from './ActivityGrid';
import { GitPanel } from './GitPanel';
import { GithubPanel } from './GithubPanel';
import { TerminalPanel } from './TerminalPanel';

/**
 * Phase 3 vertical slice (spec section 36.4): create/add/clone a project,
 * trust it, install dependencies, and run it from a workspace-bound
 * terminal — all through window.space (contextBridge). No direct
 * filesystem, process, or generic-execute access from the renderer.
 */
export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detections, setDetections] = useState<Record<string, ProjectDetectionReport>>({});
  const [devServers, setDevServers] = useState<Record<string, DevProcessInfo[]>>({});
  const [openTerminal, setOpenTerminal] = useState<Record<string, TerminalSessionInfo>>({});
  const [openGitPanel, setOpenGitPanel] = useState<Record<string, boolean>>({});

  const [createName, setCreateName] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.space.workspace.list());
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
    void window.space.project.listTemplates().then((list) => {
      setTemplates(list);
      setCreateTemplateId((current) => current || list[0]?.id || '');
    });
  }, [refreshWorkspaces]);

  const activeWorkspace = workspaces.find((workspace) => workspace.active) ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;

  const refreshProjects = useCallback(async (workspaceId: string) => {
    setProjects(await window.space.project.list(workspaceId));
  }, []);

  useEffect(() => {
    if (activeWorkspaceId) {
      void refreshProjects(activeWorkspaceId);
    } else {
      setProjects([]);
    }
  }, [activeWorkspaceId, refreshProjects]);

  async function runGuarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleCreateWorkspace(event: React.FormEvent): void {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) {
      return;
    }
    void runGuarded(async () => {
      await window.space.workspace.create({ name });
      setNewWorkspaceName('');
      await refreshWorkspaces();
    });
  }

  function handleActivate(workspaceId: string): void {
    void runGuarded(async () => {
      await window.space.workspace.activate(workspaceId);
      await refreshWorkspaces();
    });
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
      await window.space.project.add({ workspaceId, canonicalPath: inspection.path });
      await refreshProjects(workspaceId);
    });
  }

  function handleCreateProject(): void {
    if (!activeWorkspace || !createTemplateId || !createName.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded(async () => {
      const destinationParentDirectory = await window.space.project.pickParentDirectory();
      if (!destinationParentDirectory) {
        return;
      }
      await window.space.project.createFromTemplate({
        workspaceId,
        templateId: createTemplateId,
        destinationParentDirectory,
        name: createName.trim(),
      });
      setCreateName('');
      await refreshProjects(workspaceId);
    });
  }

  function handleCloneProject(): void {
    if (!activeWorkspace || !cloneUrl.trim()) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    void runGuarded(async () => {
      const destinationParentDirectory = await window.space.project.pickParentDirectory();
      if (!destinationParentDirectory) {
        return;
      }
      await window.space.project.clone({
        workspaceId,
        remoteUrl: cloneUrl.trim(),
        destinationParentDirectory,
        ...(cloneName.trim() ? { name: cloneName.trim() } : {}),
      });
      setCloneUrl('');
      setCloneName('');
      await refreshProjects(workspaceId);
    });
  }

  function handleDetect(project: Project): void {
    void runGuarded(async () => {
      const report = await window.space.project.detect({ canonicalPath: project.canonicalPath });
      setDetections((prev) => ({ ...prev, [project.id]: report }));
    });
  }

  function handleTrustDecision(project: Project, decision: TrustDecision): void {
    void runGuarded(async () => {
      await window.space.project.trustDecision({ projectId: project.id, decision });
      if (activeWorkspaceId) {
        await refreshProjects(activeWorkspaceId);
      }
    });
  }

  function handleInstall(project: Project, allowOnce: boolean): void {
    void runGuarded(async () => {
      const result = await window.space.project.installDependencies({ projectId: project.id, allowOnce });
      window.alert(
        result.succeeded
          ? `Installed dependencies with ${result.packageManager}.`
          : `Install with ${result.packageManager} failed (exit ${result.exitCode ?? 'unknown'}).`,
      );
    });
  }

  async function refreshDevServers(projectId: string): Promise<void> {
    setDevServers((prev) => ({ ...prev, [projectId]: [] }));
    const list = await window.space.devServer.list(projectId);
    setDevServers((prev) => ({ ...prev, [projectId]: list }));
  }

  function handleStartDevServer(project: Project, allowOnce: boolean): void {
    void runGuarded(async () => {
      await window.space.devServer.start({ projectId: project.id, allowOnce });
      await refreshDevServers(project.id);
    });
  }

  function handleStopDevServer(project: Project, devProcessId: string): void {
    void runGuarded(async () => {
      await window.space.devServer.stop({ devProcessId });
      await refreshDevServers(project.id);
    });
  }

  function handleOpenTerminal(project: Project): void {
    if (!activeWorkspace) {
      return;
    }
    void runGuarded(async () => {
      const session = await window.space.terminal.create({
        workspaceId: activeWorkspace.id,
        projectId: project.id,
        cols: 100,
        rows: 28,
      });
      setOpenTerminal((prev) => ({ ...prev, [project.id]: session }));
    });
  }

  function handleToggleGitPanel(project: Project): void {
    setOpenGitPanel((prev) => ({ ...prev, [project.id]: !prev[project.id] }));
  }

  function handleCloseTerminal(project: Project): void {
    const session = openTerminal[project.id];
    if (!session) {
      return;
    }
    void runGuarded(async () => {
      await window.space.terminal.dispose({ sessionId: session.id });
      setOpenTerminal((prev) => {
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
    });
  }

  return (
    <main style={{ padding: '1.5rem', maxWidth: 900 }}>
      <h1>Space</h1>

      <section>
        <h2>Workspaces</h2>
        {workspaces.length === 0 ? (
          <p>No workspaces yet.</p>
        ) : (
          <ul>
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <strong>{workspace.name}</strong>
                {workspace.active ? ' (active)' : (
                  <button type="button" disabled={busy} onClick={() => handleActivate(workspace.id)}>
                    Switch to this workspace
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreateWorkspace}>
          <input
            type="text"
            placeholder="New workspace name"
            value={newWorkspaceName}
            onChange={(event) => setNewWorkspaceName(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || newWorkspaceName.trim().length === 0}>
            Create workspace
          </button>
        </form>
      </section>

      <section>
        <h2>Projects{activeWorkspace ? ` in "${activeWorkspace.name}"` : ''}</h2>
        {!activeWorkspace ? (
          <p>Create or switch to a workspace first.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button type="button" disabled={busy} onClick={handleAddFolder}>
                Add folder&hellip;
              </button>

              <fieldset disabled={busy}>
                <legend>Create new project</legend>
                <select value={createTemplateId} onChange={(event) => setCreateTemplateId(event.target.value)}>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.displayName}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Directory name"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
                <button type="button" disabled={!createName.trim()} onClick={handleCreateProject}>
                  Create&hellip;
                </button>
              </fieldset>

              <fieldset disabled={busy}>
                <legend>Clone project</legend>
                <input
                  type="text"
                  placeholder="Remote URL or path"
                  value={cloneUrl}
                  onChange={(event) => setCloneUrl(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Directory name (optional)"
                  value={cloneName}
                  onChange={(event) => setCloneName(event.target.value)}
                />
                <button type="button" disabled={!cloneUrl.trim()} onClick={handleCloneProject}>
                  Clone&hellip;
                </button>
              </fieldset>
            </div>

            {projects.length === 0 ? (
              <p>No projects registered in this workspace yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {projects.map((project) => {
                  const detection = detections[project.id];
                  const servers = devServers[project.id] ?? [];
                  const runningServer = servers.find((s) => s.state === 'running');
                  const session = openTerminal[project.id];
                  return (
                    <li key={project.id} style={{ border: '1px solid #444', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
                      <div>
                        <strong>{project.name}</strong> &mdash; {project.canonicalPath}{' '}
                        <span style={{ fontWeight: 'bold', color: project.trustState === 'trusted' ? 'green' : 'orange' }}>
                          [{project.trustState}]
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        <button type="button" disabled={busy} onClick={() => handleDetect(project)}>
                          Detect
                        </button>
                        {project.trustState === 'untrusted' ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => handleTrustDecision(project, 'trust-this-project')}>
                              Trust this project
                            </button>
                            <button type="button" disabled={busy} onClick={() => handleTrustDecision(project, 'keep-untrusted')}>
                              Keep untrusted
                            </button>
                            <button type="button" disabled={busy} onClick={() => handleInstall(project, true)}>
                              Install deps (allow once)
                            </button>
                          </>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => handleInstall(project, false)}>
                            Install dependencies
                          </button>
                        )}
                        {runningServer ? (
                          <button type="button" disabled={busy} onClick={() => handleStopDevServer(project, runningServer.id)}>
                            Stop dev server{runningServer.detectedUrl ? ` (${runningServer.detectedUrl})` : ''}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleStartDevServer(project, project.trustState === 'untrusted')}
                          >
                            Start dev server
                          </button>
                        )}
                        {session ? (
                          <button type="button" disabled={busy} onClick={() => handleCloseTerminal(project)}>
                            Close terminal
                          </button>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => handleOpenTerminal(project)}>
                            Open terminal
                          </button>
                        )}
                        {project.repositoryRoot && (
                          <button type="button" disabled={busy} onClick={() => handleToggleGitPanel(project)}>
                            {openGitPanel[project.id] ? 'Hide Git' : 'Git'}
                          </button>
                        )}
                      </div>
                      {detection && (
                        <ul style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                          {detection.facts.map((fact) => (
                            <li key={fact.id}>
                              {fact.label} ({Math.round(fact.confidence * 100)}%) &mdash; {fact.evidence}
                            </li>
                          ))}
                        </ul>
                      )}
                      {session && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <TerminalPanel session={session} />
                        </div>
                      )}
                      {openGitPanel[project.id] && project.repositoryRoot && <GitPanel project={project} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      {activeWorkspace && <GithubPanel workspaceId={activeWorkspace.id} />}

      {activeWorkspace && <ActivityGrid workspaceId={activeWorkspace.id} />}

      {error && <p role="alert">{error}</p>}
    </main>
  );
}
