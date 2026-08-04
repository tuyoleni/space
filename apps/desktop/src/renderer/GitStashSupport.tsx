/**
 * Git Stash Support: provides stash/pop/drop UI in the Changes view.
 * Renders a list of stashes with one-click pop and drop.
 */
import {
  Archive,
  ArrowDownToLine,
  Trash2,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { Button } from '@space/ui';

export interface GitStash {
  readonly ref: string;
  readonly message: string;
  readonly date: Date;
  readonly branchName?: string;
}

interface GitStashSupportProps {
  readonly stashes: readonly GitStash[];
  readonly onPop: (ref: string) => void;
  readonly onApply: (ref: string) => void;
  readonly onDrop: (ref: string) => void;
  readonly onRefresh: () => void;
}

function formatStashDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function StashItem({ stash, onPop, onApply, onDrop }: {
  stash: GitStash;
  onPop: () => void;
  onApply: () => void;
  onDrop: () => void;
}) {
  return (
    <div className="group flex items-start gap-2.5 border-b border-border/30 px-3 py-2 hover:bg-surface-hover last:border-b-0">
      <Archive size={13} className="mt-0.5 shrink-0 text-fg-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-fg-faint">{stash.ref}</span>
          {stash.branchName && (
            <span className="rounded bg-surface px-1 py-0.5 text-[9px] text-accent">{stash.branchName}</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-fg">{stash.message}</p>
        <span className="flex items-center gap-1 text-[10px] text-fg-faint">
          <Clock size={9} />
          {formatStashDate(stash.date)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="sm" onClick={onPop} title="Pop stash (apply + remove)">
          <ArrowDownToLine size={11} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onApply} title="Apply stash (keep in list)">
          <RefreshCw size={11} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDrop} title="Drop stash permanently" className="hover:text-danger">
          <Trash2 size={11} />
        </Button>
      </div>
    </div>
  );
}

export function GitStashSupport({ stashes, onPop, onApply, onDrop, onRefresh }: GitStashSupportProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <Archive size={13} className="text-fg-faint" />
          Stash
          <span className="text-fg-faint">({stashes.length})</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw size={11} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {stashes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Archive size={24} className="mb-2 text-fg-faint" />
            <p className="text-xs text-fg-muted">No stashes</p>
            <p className="mt-1 text-[10px] text-fg-faint">Stash changes with git stash to see them here.</p>
          </div>
        ) : (
          stashes.map((stash) => (
            <StashItem
              key={stash.ref}
              stash={stash}
              onPop={() => onPop(stash.ref)}
              onApply={() => onApply(stash.ref)}
              onDrop={() => onDrop(stash.ref)}
            />
          ))
        )}
      </div>
    </div>
  );
}
