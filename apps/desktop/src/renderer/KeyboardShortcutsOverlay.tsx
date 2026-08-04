/**
 * Keyboard Shortcuts Overlay: shows all available keyboard shortcuts
 * in a categorized grid. Opens with Cmd+/ (or Ctrl+/ on non-Mac).
 */
import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from '@space/ui';

interface Shortcut {
  readonly keys: string;
  readonly label: string;
  readonly category: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  // Navigation
  { keys: '⌘1', label: 'Go to Home', category: 'Navigation' },
  { keys: '⌘2', label: 'Go to Changes', category: 'Navigation' },
  { keys: '⌘3', label: 'Go to Terminal', category: 'Navigation' },
  { keys: '⌘4', label: 'Go to Environment', category: 'Navigation' },
  { keys: '⌘5', label: 'Go to Projects', category: 'Navigation' },
  { keys: '⌘6', label: 'Go to System', category: 'Navigation' },

  // Git
  { keys: '⌘⇧F', label: 'Fetch from remote', category: 'Git' },
  { keys: '⌘⇧P', label: 'Push to remote', category: 'Git' },
  { keys: '⌘⏎', label: 'Quick commit', category: 'Git' },
  { keys: '⌘B', label: 'Create branch', category: 'Git' },

  // Terminal
  { keys: '⌘`', label: 'Focus terminal', category: 'Terminal' },
  { keys: '⌘⇧D', label: 'Split terminal', category: 'Terminal' },
  { keys: '⌘W', label: 'Close terminal pane', category: 'Terminal' },

  // General
  { keys: '⌘K', label: 'Command palette', category: 'General' },
  { keys: '⌘/', label: 'Keyboard shortcuts', category: 'General' },
  { keys: '⌘,', label: 'Settings', category: 'General' },
  { keys: '⌘/', label: 'About Space', category: 'General' },
  { keys: '⌘Q', label: 'Quit Space', category: 'General' },
  { keys: '⌘⇧C', label: 'Copy diagnostics', category: 'General' },

  // Search
  { keys: '⌘⇧O', label: 'Open recent project', category: 'Search' },
  { keys: '⌘F', label: 'Find in terminal', category: 'Search' },
];

interface KeyboardShortcutsProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsOverlay({ open, onOpenChange }: KeyboardShortcutsProps) {
  const [search, setSearch] = useState('');

  const categories = useMemo(() => {
    const filtered = SHORTCUTS.filter((s) =>
      s.label.toLowerCase().includes(search.toLowerCase()) ||
      s.keys.toLowerCase().includes(search.toLowerCase())
    );

    const grouped: Record<string, Shortcut[]> = {};
    for (const shortcut of filtered) {
      const list = grouped[shortcut.category];
      if (list) {
        list.push(shortcut);
      } else {
        grouped[shortcut.category] = [shortcut];
      }
    }
    return grouped;
  }, [search]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard Shortcuts"
      size="lg"
    >
      {/* Search */}
      <div className="relative mb-4">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          type="text"
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-fg placeholder-fg-faint outline-none focus:border-accent"
          autoFocus
        />
      </div>

      {/* Shortcut categories */}
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {Object.entries(categories).map(([category, shortcuts]) => (
          <div key={category}>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{category}</h3>
            <div className="space-y-0.5">
              {shortcuts.map((shortcut, i) => (
                <div
                  key={`${category}-${i}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-hover"
                >
                  <span className="text-xs text-fg-muted">{shortcut.label}</span>
                  <div className="flex items-center gap-0.5">
                    {shortcut.keys.split(' ').map((key, ki) => (
                      <kbd
                        key={ki}
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface px-1 text-[10px] font-mono font-medium text-fg"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(categories).length === 0 && (
          <div className="py-8 text-center text-xs text-fg-muted">No shortcuts match your search.</div>
        )}
      </div>
    </Dialog>
  );
}
