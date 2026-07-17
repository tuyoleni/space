import { useState } from 'react';
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  FolderPlus,
  GitFork,
  Home,
  Plus,
  Search,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { siGithub } from 'simple-icons';
import type { Project, WorkspaceSummary } from '@space/contracts';
import { Badge, Button, Dialog, Input, NavItem, StatusDot, cn } from '@space/ui';
import type { NavView } from './nav';
import { ProjectIcon } from './ProjectIcon';
import { BrandIcon } from './brand-icons';

interface SidebarProps {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly activeWorkspace: WorkspaceSummary | null;
  readonly projects: readonly Project[];
  readonly selectedProjectId: string | null;
  readonly runningProjectIds: ReadonlySet<string>;
  readonly changedFileCount: number;
  readonly terminalCount: number;
  readonly diskFreeBytes: number | null;
  readonly busy: boolean;
  readonly view: NavView;
  readonly onNavigate: (view: NavView) => void;
  readonly onSelectProject: (projectId: string) => void;
  readonly onActivateWorkspace: (workspaceId: string) => void;
  readonly onCreateWorkspace: (name: string) => void;
  readonly onNewProject: () => void;
  readonly onAddFolder: () => void;
  readonly onCloneRepository: () => void;
}

export function Sidebar({
  workspaces,
  activeWorkspace,
  projects,
  selectedProjectId,
  runningProjectIds,
  changedFileCount,
  terminalCount,
  diskFreeBytes,
  busy,
  view,
  onNavigate,
  onSelectProject,
  onActivateWorkspace,
  onCreateWorkspace,
  onNewProject,
  onAddFolder,
  onCloneRepository,
}: SidebarProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('');

  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function submitCreate(): void {
    const name = newName.trim();
    if (!name) {
      return;
    }
    onCreateWorkspace(name);
    setNewName('');
    setCreateOpen(false);
  }

  const NAV_ITEMS: readonly { readonly view: NavView; readonly label: string; readonly icon: JSX.Element; readonly badge?: JSX.Element }[] = [
    { view: 'home', label: 'Home', icon: <Home size={16} /> },
    {
      view: 'changes',
      label: 'GitHub',
      icon: <BrandIcon icon={siGithub} size={16} monochrome />,
      ...(changedFileCount > 0 ? { badge: <Badge variant="accent">{changedFileCount}</Badge> } : {}),
    },
    {
      view: 'terminal',
      label: 'Terminal',
      icon: <TerminalSquare size={16} />,
      ...(terminalCount > 0 ? { badge: <StatusDot tone="success" label={`${terminalCount} running`} /> } : {}),
    },
    { view: 'environment', label: 'Environment', icon: <Wrench size={16} /> },
  ];

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Empty draggable strip — clears the macOS traffic lights and keeps
          the window draggable here; the "Space" wordmark was removed. */}
      <div className="space-titlebar-drag h-7 shrink-0" />

      <nav className="flex flex-col gap-0.5 px-3 pb-3 pt-2">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.view}
            icon={item.icon}
            label={item.label}
            active={view === item.view}
            badge={item.badge}
            onClick={() => onNavigate(item.view)}
          />
        ))}
      </nav>

      <div className="mx-3 border-t border-border" />

      <div className="px-3 pt-3">
        <RadixDropdownMenu.Root>
          <RadixDropdownMenu.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left',
                'hover:bg-surface-hover disabled:opacity-50',
                'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-fg">{activeWorkspace?.name ?? 'No workspace'}</span>
                {activeWorkspace && <Badge variant="success">Active</Badge>}
              </span>
              <ChevronDown size={13} className="shrink-0 text-fg-muted" />
            </button>
          </RadixDropdownMenu.Trigger>
          <RadixDropdownMenu.Portal>
            <RadixDropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-50 w-56 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-xl backdrop-blur-2xl"
            >
              {workspaces.map((workspace) => (
                <RadixDropdownMenu.Item
                  key={workspace.id}
                  onSelect={() => onActivateWorkspace(workspace.id)}
                  className="flex h-8 cursor-pointer select-none items-center justify-between rounded px-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
                >
                  <span className="truncate">{workspace.name}</span>
                  {workspace.active && <Badge variant="success">Active</Badge>}
                </RadixDropdownMenu.Item>
              ))}
              <RadixDropdownMenu.Separator className="my-1 h-px bg-border" />
              <RadixDropdownMenu.Item
                onSelect={() => setCreateOpen(true)}
                className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded px-2 text-sm text-fg-muted outline-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg"
              >
                <Plus size={13} />
                New workspace&hellip;
              </RadixDropdownMenu.Item>
            </RadixDropdownMenu.Content>
          </RadixDropdownMenu.Portal>
        </RadixDropdownMenu.Root>

        <div className="relative mt-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-3">
        {filteredProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelectProject(project.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2',
              project.id === selectedProjectId ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <ProjectIcon projectId={project.id} canonicalPath={project.canonicalPath} size={18} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {runningProjectIds.has(project.id) && <StatusDot tone="success" label="dev server running" />}
          </button>
        ))}
        {filteredProjects.length === 0 && <p className="px-2 py-3 text-center text-xs text-fg-faint">No projects match.</p>}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        <Button variant="secondary" size="sm" className="justify-start" onClick={onNewProject} disabled={busy}>
          <Plus size={14} /> New Project
        </Button>
        <Button variant="secondary" size="sm" className="justify-start" onClick={onAddFolder} disabled={busy}>
          <FolderPlus size={14} /> Add Folder
        </Button>
        <Button variant="secondary" size="sm" className="justify-start" onClick={onCloneRepository} disabled={busy}>
          <GitFork size={14} /> Clone Repository
        </Button>
        {diskFreeBytes !== null && (
          <p className="mt-1 px-1 text-[11px] text-fg-faint">Disk: {(diskFreeBytes / 1024 ** 3).toFixed(1)} GB free</p>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New workspace"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!newName.trim()} onClick={submitCreate}>
              Create
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Workspace name
          <Input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitCreate()}
            placeholder="e.g. Asmbly"
          />
        </label>
      </Dialog>
    </aside>
  );
}
