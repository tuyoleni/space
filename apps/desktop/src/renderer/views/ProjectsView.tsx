import { useState } from 'react';
import { FolderPlus, GitFork, Plus, Search } from 'lucide-react';
import type { Project, ProjectTemplateSummary, WorkspaceSummary } from '@space/contracts';
import { Badge, Button, EmptyState, Input } from '@space/ui';
import type { ProjectActions, ProjectRuntimeState } from '../AppShell';
import { ProjectIcon } from '../ProjectIcon';
import { ProjectDetail } from './ProjectDetail';
import { CloneProjectDialog, CreateProjectDialog } from './ProjectDialogs';

interface ProjectsViewProps {
  readonly workspace: WorkspaceSummary;
  readonly projects: readonly Project[];
  readonly templates: readonly ProjectTemplateSummary[];
  readonly runtime: ProjectRuntimeState;
  readonly actions: ProjectActions;
  readonly busy: boolean;
  readonly selectedProjectId: string | null;
  readonly onSelectProject: (projectId: string | null) => void;
  readonly onAddFolder: () => void;
  readonly onCreateProject: (templateId: string, name: string) => void;
  readonly onCloneProject: (url: string, name: string) => void;
}

export function ProjectsView({
  workspace,
  projects,
  templates,
  runtime,
  actions,
  busy,
  selectedProjectId,
  onSelectProject,
  onAddFolder,
  onCreateProject,
  onCloneProject,
}: ProjectsViewProps) {
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);

  const filtered = projects.filter((project) => project.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter projects…"
              className="pl-7"
            />
          </div>
        </div>
        <div className="flex gap-1.5 border-b border-border p-2">
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setCreateOpen(true)} disabled={busy}>
            <Plus size={13} /> Create
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" onClick={onAddFolder} disabled={busy}>
            <FolderPlus size={13} /> Add
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setCloneOpen(true)} disabled={busy}>
            <GitFork size={13} /> Clone
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-xs text-fg-faint">No projects match.</p>
          ) : (
            filtered.map((project) => {
              const running = (runtime.devServers[project.id] ?? []).some((server) => server.state === 'running');
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className={
                    'flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover ' +
                    (project.id === selectedProjectId ? 'bg-surface-hover' : '')
                  }
                >
                  <ProjectIcon projectId={project.id} canonicalPath={project.canonicalPath} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{project.name}</span>
                    <span className="block truncate text-xs text-fg-faint">{project.canonicalPath}</span>
                  </span>
                  {running && <Badge variant="success">Live</Badge>}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        {selectedProject ? (
          <ProjectDetail
            key={selectedProject.id}
            workspace={workspace}
            project={selectedProject}
            runtime={runtime}
            actions={actions}
            busy={busy}
          />
        ) : (
          <div className="p-6">
            <EmptyState title="Select a project" description="Pick a project from the list to see its status, Git, GitHub, and terminal." />
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} templates={templates} onCreate={onCreateProject} />
      <CloneProjectDialog open={cloneOpen} onOpenChange={setCloneOpen} onClone={onCloneProject} />
    </div>
  );
}
