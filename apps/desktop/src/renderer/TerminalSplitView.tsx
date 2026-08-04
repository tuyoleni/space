/**
 * Terminal Split View: allows splitting the terminal area into
 * multiple panes (horizontal or vertical). Each pane is an independent
 * xterm.js terminal instance.
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { Columns2, Rows2, X, Plus } from 'lucide-react';
import { cn } from '@space/ui';

export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalPane {
  readonly id: string;
  readonly title: string;
  readonly isActive: boolean;
}

interface TerminalSplitViewProps {
  readonly panes: readonly TerminalPane[];
  readonly activePaneId: string;
  readonly onSelectPane: (id: string) => void;
  readonly onClosePane: (id: string) => void;
  readonly onSplitPane: (id: string, direction: SplitDirection) => void;
  readonly onNewPane: () => void;
  readonly renderPane: (pane: TerminalPane) => React.ReactNode;
}

function PaneTab({ pane, isActive, onSelect, onClose, canClose }: {
  pane: TerminalPane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  canClose: boolean;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 border-r border-border/50 px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
        isActive ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
      onClick={onSelect}
    >
      <span className="max-w-[100px] truncate">{pane.title}</span>
      {canClose && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

export function TerminalSplitView({
  panes,
  activePaneId,
  onSelectPane,
  onClosePane,
  onSplitPane,
  onNewPane,
  renderPane,
}: TerminalSplitViewProps) {
  const activePane = useMemo(() => panes.find((p) => p.id === activePaneId), [panes, activePaneId]);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-sidebar">
        <div className="flex flex-1 overflow-x-auto">
          {panes.map((pane) => (
            <PaneTab
              key={pane.id}
              pane={pane}
              isActive={pane.id === activePaneId}
              onSelect={() => onSelectPane(pane.id)}
              onClose={() => onClosePane(pane.id)}
              canClose={panes.length > 1}
            />
          ))}
        </div>
        <div className="flex items-center gap-0.5 px-1">
          <button
            type="button"
            onClick={() => activePaneId && onSplitPane(activePaneId, 'horizontal')}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
            title="Split horizontally"
          >
            <Columns2 size={12} />
          </button>
          <button
            type="button"
            onClick={() => activePaneId && onSplitPane(activePaneId, 'vertical')}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
            title="Split vertically"
          >
            <Rows2 size={12} />
          </button>
          <button
            type="button"
            onClick={onNewPane}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
            title="New terminal"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Active pane content */}
      <div className="flex-1 overflow-hidden">
        {activePane && renderPane(activePane)}
      </div>
    </div>
  );
}

/** Hook to manage terminal split state. */
export function useTerminalSplit(initialTitle = 'Terminal') {
  const [panes, setPanes] = useState<readonly TerminalPane[]>([
    { id: 'term-1', title: initialTitle, isActive: true },
  ]);
  const [activePaneId, setActivePaneId] = useState('term-1');
  const counterRef = useRef(1);

  const selectPane = useCallback((id: string) => {
    setActivePaneId(id);
    setPanes((prev) => prev.map((p) => ({ ...p, isActive: p.id === id })));
  }, []);

  const closePane = useCallback((id: string) => {
    setPanes((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      if (activePaneId === id) {
        const idx = prev.findIndex((p) => p.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        if (newActive) {
          setActivePaneId(newActive.id);
          return next.map((p) => ({ ...p, isActive: p.id === newActive.id }));
        }
      }
      return next;
    });
  }, [activePaneId]);

  const splitPane = useCallback((id: string, _direction: SplitDirection) => {
    counterRef.current += 1;
    const newId = `term-${counterRef.current}`;
    const newPane: TerminalPane = { id: newId, title: `Terminal ${counterRef.current}`, isActive: false };
    setPanes((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, newPane);
      return next;
    });
    setActivePaneId(newId);
    setPanes((prev) => prev.map((p) => ({ ...p, isActive: p.id === newId })));
  }, []);

  const newPane = useCallback(() => {
    counterRef.current += 1;
    const newId = `term-${counterRef.current}`;
    const newTerminal: TerminalPane = { id: newId, title: `Terminal ${counterRef.current}`, isActive: true };
    setPanes((prev) => [...prev.map((p) => ({ ...p, isActive: false })), newTerminal]);
    setActivePaneId(newId);
  }, []);

  return {
    panes,
    activePaneId,
    selectPane,
    closePane,
    splitPane,
    newPane,
  };
}
