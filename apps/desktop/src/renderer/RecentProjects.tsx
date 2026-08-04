/**
 * Recent Projects Quick Access: shows recently opened projects
 * in a floating panel accessible from the sidebar or Cmd+Shift+O.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  FolderOpen,
  Search,
  Star,
  ArrowRight,
} from 'lucide-react';
import { Dialog, cn } from '@space/ui';

interface RecentProject {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly lastOpened: Date;
  readonly isFavorite?: boolean;
}

interface RecentProjectsProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly RecentProject[];
  readonly onSelectProject: (id: string) => void;
  readonly onToggleFavorite: (id: string) => void;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function RecentProjects({
  open,
  onOpenChange,
  projects,
  onSelectProject,
  onToggleFavorite,
}: RecentProjectsProps) {
  const [search, setSearch] = useState('');

  const { favorites, recents } = useMemo(() => {
    const filtered = projects.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase())
    );
    return {
      favorites: filtered.filter((p) => p.isFavorite),
      recents: filtered.filter((p) => !p.isFavorite).slice(0, 10),
    };
  }, [projects, search]);

  const handleSelect = useCallback((id: string) => {
    onSelectProject(id);
    onOpenChange(false);
    setSearch('');
  }, [onSelectProject, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recent Projects"
      size="lg"
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-fg placeholder-fg-faint outline-none focus:border-accent"
          autoFocus
        />
      </div>

      {/* Favorites */}
      {favorites.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Favorites</h3>
          <div className="space-y-0.5">
            {favorites.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onSelect={() => handleSelect(project.id)}
                onToggleFavorite={() => onToggleFavorite(project.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recents */}
      <div>
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Recent</h3>
        {recents.length === 0 ? (
          <div className="py-8 text-center text-xs text-fg-muted">No recent projects</div>
        ) : (
          <div className="space-y-0.5">
            {recents.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onSelect={() => handleSelect(project.id)}
                onToggleFavorite={() => onToggleFavorite(project.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ProjectRow({ project, onSelect, onToggleFavorite }: {
  project: RecentProject;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-hover cursor-pointer"
      onClick={onSelect}
    >
      <FolderOpen size={14} className="shrink-0 text-fg-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{project.name}</p>
        <p className="truncate text-[10px] text-fg-faint">{project.path}</p>
      </div>
      <span className="shrink-0 text-[10px] text-fg-faint">
        {formatRelativeTime(project.lastOpened)}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={cn(
          'shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100',
          project.isFavorite ? 'text-warning' : 'text-fg-faint hover:text-warning',
        )}
        title={project.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={11} fill={project.isFavorite ? 'currentColor' : 'none'} />
      </button>
      <ArrowRight size={11} className="shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
