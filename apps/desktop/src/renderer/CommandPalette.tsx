/**
 * Command palette (Cmd+K / Ctrl+K): a quick-switch surface for navigating
 * views, switching projects, running git actions, and triggering common
 * operations without leaving the keyboard. Inspired by VS Code / Linear /
 * Raycast — type-ahead fuzzy matching over a flat list of commands.
 *
 * Keyboard: Cmd+K to open, Escape to close, ArrowUp/Down to navigate,
 * Enter to execute, typing to filter. The palette captures focus and
 * restores it to the previously focused element on close.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
  Home,
  GitBranch,
  Terminal,
  Settings,
  FolderOpen,
  LayoutGrid,
  Monitor,
  Plus,
  Search,
  ArrowRight,
  GitCommitHorizontal,
  Download,
  Upload,
  Command,
} from 'lucide-react';
import { cn } from '@space/ui';
import type { NavView } from './nav';
import type { Project, GitStatusSummary } from '@space/contracts';

export interface CommandPaletteAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: React.ReactNode;
  readonly category: string;
  readonly shortcut?: string;
  readonly action: () => void;
  readonly enabled?: boolean;
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly actions: readonly CommandPaletteAction[];
}

function fuzzyMatch(query: string, text: string): boolean {
  if (query.length === 0) return true;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti += 1) {
    if (lowerText[ti] === lowerQuery[qi]) {
      qi += 1;
    }
  }
  return qi === lowerQuery.length;
}

function highlightMatch(query: string, text: string): React.ReactNode {
  if (query.length === 0) return text;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let qi = 0;
  let lastEnd = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti += 1) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (ti > lastEnd) {
        parts.push(text.slice(lastEnd, ti));
      }
      parts.push(
        <span key={ti} className="font-semibold text-accent">
          {text[ti]}
        </span>,
      );
      lastEnd = ti + 1;
      qi += 1;
    }
  }
  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }
  return parts;
}

export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions.filter((a) => a.enabled !== false);
    return actions.filter((a) => a.enabled !== false && fuzzyMatch(query, `${a.label} ${a.category} ${a.description ?? ''}`));
  }, [actions, query]);

  const categories = useMemo(() => {
    const map = new Map<string, CommandPaletteAction[]>();
    for (const action of filtered) {
      const existing = map.get(action.category) ?? [];
      existing.push(action);
      map.set(action.category, existing);
    }
    return [...map.entries()];
  }, [filtered]);

  const flatList = useMemo(() => filtered, [filtered]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to ensure the DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const execute = useCallback(
    (action: CommandPaletteAction) => {
      if (action.enabled === false) return;
      onOpenChange(false);
      // Execute on next tick so the dialog closes first
      requestAnimationFrame(() => action.action());
    },
    [onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(flatList.length, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + flatList.length) % Math.max(flatList.length, 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            execute(flatList[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [flatList, selectedIndex, execute, onOpenChange],
  );

  let runningIndex = -1;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <RadixDialog.Content
          className="fixed left-1/2 top-[20%] z-[200] w-full max-w-lg -translate-x-1/2 rounded-lg border border-border bg-popover shadow-2xl"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search size={16} className="shrink-0 text-fg-muted" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type a command or search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-fg-faint sm:inline">
              esc
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
            {flatList.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-fg-muted">
                No matching commands
              </div>
            ) : (
              categories.map(([category, items]) => (
                <div key={category} className="mb-1">
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                    {category}
                  </div>
                  {items.map((action) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={action.id}
                        data-index={idx}
                        type="button"
                        disabled={action.enabled === false}
                        onClick={() => execute(action)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          isSelected ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg',
                          action.enabled === false && 'cursor-not-allowed opacity-40',
                        )}
                      >
                        <span className="shrink-0 text-fg-faint">{action.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{highlightMatch(query, action.label)}</span>
                          {action.description && (
                            <span className="block truncate text-[11px] text-fg-faint">
                              {action.description}
                            </span>
                          )}
                        </span>
                        {action.shortcut && (
                          <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-fg-faint">
                            {action.shortcut}
                          </kbd>
                        )}
                        {isSelected && (
                          <ArrowRight size={12} className="shrink-0 text-accent" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hints */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-fg-faint">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-surface px-1 py-0.5">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-surface px-1 py-0.5">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-surface px-1 py-0.5">esc</kbd>
                close
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Command size={10} />
              K
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Helper to build standard navigation actions for the command palette. */
export function buildNavigationActions(
  currentView: NavView,
  onNavigate: (view: NavView) => void,
): CommandPaletteAction[] {
  return [
    { id: 'nav:home', label: 'Go to Home', description: 'Dashboard overview', icon: <Home size={15} />, category: 'Navigation', action: () => onNavigate('home'), shortcut: '⌘1' },
    { id: 'nav:changes', label: 'Go to GitHub', description: 'Changes, PRs, commits', icon: <GitBranch size={15} />, category: 'Navigation', action: () => onNavigate('changes'), shortcut: '⌘2' },
    { id: 'nav:terminal', label: 'Go to Terminal', description: 'Terminal sessions', icon: <Terminal size={15} />, category: 'Navigation', action: () => onNavigate('terminal'), shortcut: '⌘3' },
    { id: 'nav:environment', label: 'Go to Environment', description: 'Tools and packages', icon: <Settings size={15} />, category: 'Navigation', action: () => onNavigate('environment'), shortcut: '⌘4' },
    { id: 'nav:projects', label: 'Go to Projects', description: 'All projects', icon: <LayoutGrid size={15} />, category: 'Navigation', action: () => onNavigate('projects'), shortcut: '⌘5' },
    { id: 'nav:system', label: 'Go to System', description: 'Activity monitor', icon: <Monitor size={15} />, category: 'Navigation', action: () => onNavigate('system'), shortcut: '⌘6' },
  ];
}

/** Helper to build project-switching actions. */
export function buildProjectActions(
  projects: readonly Project[],
  selectedProjectId: string | null,
  onSelectProject: (projectId: string) => void,
): CommandPaletteAction[] {
  return projects.map((project) => ({
    id: `project:${project.id}`,
    label: project.name,
    description: project.canonicalPath,
    icon: <FolderOpen size={15} />,
    category: 'Projects',
    ...(project.id === selectedProjectId ? { shortcut: 'current' } : {}),
    enabled: project.id !== selectedProjectId,
    action: () => onSelectProject(project.id),
  }));
}

/** Helper to build git actions for the selected project. */
export function buildGitActions(
  selectedProject: Project | null,
  gitStatus: GitStatusSummary | null,
  handlers: {
    onFetch: () => void;
    onPush: () => void;
    onCommit: () => void;
    onCreateBranch: () => void;
  },
): CommandPaletteAction[] {
  if (!selectedProject) return [];
  return [
    { id: 'git:fetch', label: 'Fetch from remote', icon: <Download size={15} />, category: 'Git', action: handlers.onFetch, enabled: !!selectedProject?.repositoryRoot },
    { id: 'git:push', label: 'Push to remote', ...(gitStatus?.branch.branchName ? { description: `Push ${gitStatus.branch.branchName}` } : {}), icon: <Upload size={15} />, category: 'Git', action: handlers.onPush, enabled: !!gitStatus?.branch.branchName },
    { id: 'git:commit', label: 'Commit staged changes', icon: <GitCommitHorizontal size={15} />, category: 'Git', action: handlers.onCommit, enabled: false },
    { id: 'git:new-branch', label: 'Create new branch', icon: <Plus size={15} />, category: 'Git', action: handlers.onCreateBranch, enabled: !!selectedProject?.repositoryRoot },
  ];
}

export { Command as CommandIcon, Search as SearchIcon };
