/**
 * Git Log Viewer: renders commit history in a visual graph layout.
 * Shows author, date, message, and a dot-graph of branch topology.
 * Supports expand/collapse, search, and "load more" pagination.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  GitCommitHorizontal,
  User,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  RotateCcw,
  Tag,
  GitBranch,
} from 'lucide-react';
import { cn } from '@space/ui';

export interface GitLogEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly date: Date;
  readonly message: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly branch?: string;
  readonly isMerge: boolean;
  readonly parentCount: number;
}

interface GitLogViewerProps {
  readonly entries: readonly GitLogEntry[];
  readonly loading?: boolean;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly onRefresh?: () => void;
  readonly onCheckout?: (hash: string) => void;
}

function formatLogDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getAuthorColor(author: string): string {
  const colors = [
    'text-blue-400', 'text-green-400', 'text-purple-400', 'text-yellow-400',
    'text-pink-400', 'text-cyan-400', 'text-orange-400', 'text-teal-400',
  ];
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = author.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? 'text-fg-muted';
}

function CommitCard({ entry, onCheckout }: { entry: GitLogEntry; onCheckout?: ((hash: string) => void) | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const authorColor = getAuthorColor(entry.author);

  return (
    <div className="group flex gap-3 border-b border-border/30 px-3 py-2.5 transition-colors hover:bg-surface-hover">
      {/* Commit dot */}
      <div className="flex flex-col items-center pt-0.5">
        <div className={cn(
          'h-2.5 w-2.5 rounded-full border-2',
          entry.isMerge ? 'border-accent bg-accent/30' : 'border-fg-faint bg-surface',
        )} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg leading-tight">{entry.message}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-faint">
              <span className={cn('font-medium', authorColor)}>{entry.author}</span>
              <span>·</span>
              <span className="flex items-center gap-0.5">
                <Clock size={9} />
                {formatLogDate(entry.date)}
              </span>
              <span>·</span>
              <span className="font-mono">{entry.shortHash}</span>
              {entry.tags && entry.tags.length > 0 && (
                <>
                  <span>·</span>
                  {entry.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-0.5 rounded bg-accent/10 px-1 py-0.5 text-accent">
                      <Tag size={8} />
                      {tag}
                    </span>
                  ))}
                </>
              )}
              {entry.isMerge && (
                <span className="flex items-center gap-0.5 rounded bg-purple-500/10 px-1 py-0.5 text-purple-400">
                  <GitBranch size={8} />
                  merge
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {entry.body && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="rounded p-0.5 text-fg-faint hover:bg-surface hover:text-fg"
                title="Show commit body"
              >
                {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            )}
            {onCheckout && (
              <button
                type="button"
                onClick={() => onCheckout(entry.hash)}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-faint hover:bg-surface hover:text-accent"
                title="Checkout this commit"
              >
                checkout
              </button>
            )}
          </div>
        </div>

        {/* Expanded body */}
        {expanded && entry.body && (
          <div className="mt-2 rounded-md bg-surface p-2 text-[11px] leading-relaxed text-fg-muted whitespace-pre-wrap">
            {entry.body}
          </div>
        )}
      </div>
    </div>
  );
}

export function GitLogViewer({
  entries,
  loading = false,
  hasMore = false,
  onLoadMore,
  onRefresh,
  onCheckout,
}: GitLogViewerProps) {
  const [search, setSearch] = useState('');
  const [showMerge, setShowMerge] = useState(true);

  const filtered = useMemo(() => {
    let result = entries;
    if (!showMerge) {
      result = result.filter((e) => !e.isMerge);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.author.toLowerCase().includes(q) ||
          e.shortHash.toLowerCase().includes(q),
      );
    }
    return result;
  }, [entries, search, showMerge]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commits..."
            className="w-full rounded-md border border-border bg-surface py-1 pl-7 pr-2 text-[11px] text-fg placeholder-fg-faint outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowMerge(!showMerge)}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
            showMerge ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Filter size={10} />
          Merges
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
            title="Refresh"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <GitCommitHorizontal size={28} className="mb-2 text-fg-faint" />
            <p className="text-xs text-fg-muted">No commits found</p>
            {search && <p className="mt-1 text-[10px] text-fg-faint">Try a different search term.</p>}
          </div>
        ) : (
          <>
            {filtered.map((entry) => (
              <CommitCard key={entry.hash} entry={entry} onCheckout={onCheckout} />
            ))}
            {loading && (
              <div className="flex items-center justify-center py-4 text-xs text-fg-muted">
                <span className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-fg-faint border-t-accent" />
                Loading...
              </div>
            )}
            {hasMore && !loading && (
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full py-2.5 text-center text-xs font-medium text-accent hover:bg-surface-hover"
              >
                Load more commits
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
