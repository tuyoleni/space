import { useCallback, useEffect, useState } from 'react';
import type { Project, WorkspaceSummary } from '@space/contracts';

/**
 * Phase 1 vertical slice (spec section 36.2): create/switch workspaces and
 * add folders, entirely through window.space (contextBridge) — no direct
 * filesystem or process access from the renderer.
 */
export function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.space.workspace.list());
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
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

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
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
            <button type="button" disabled={busy} onClick={handleAddFolder}>
              Add folder&hellip;
            </button>
            {projects.length === 0 ? (
              <p>No projects registered in this workspace yet.</p>
            ) : (
              <ul>
                {projects.map((project) => (
                  <li key={project.id}>
                    {project.name} &mdash; {project.canonicalPath}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {error && <p role="alert">{error}</p>}
    </main>
  );
}
