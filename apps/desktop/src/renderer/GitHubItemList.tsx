/**
 * GitHub PR/Issue viewer: shows pull requests and issues for the current
 * project in a compact list format. Supports filtering by state
 * (open/closed/merged) and type (PR vs Issue).
 */
import { useState, useMemo } from 'react';
import {
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ExternalLink,
  User,
  Clock,
} from 'lucide-react';
import { cn } from '@space/ui';

export type GitHubItemState = 'open' | 'closed' | 'merged';
export type GitHubItemType = 'pull_request' | 'issue';

export interface GitHubItem {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly state: GitHubItemState;
  readonly type: GitHubItemType;
  readonly author: string;
  readonly createdAt: Date;
  readonly commentCount: number;
  readonly labels: readonly string[];
  readonly url: string;
}

interface GitHubItemListProps {
  readonly items: readonly GitHubItem[];
  readonly loading?: boolean;
  readonly onRefresh?: () => void;
}

const STATE_ICONS: Record<GitHubItemState, typeof CircleDot> = {
  open: CircleDot,
  closed: XCircle,
  merged: GitPullRequest,
};

const STATE_STYLES: Record<GitHubItemState, string> = {
  open: 'text-success',
  closed: 'text-danger',
  merged: 'text-purple-400',
};

const STATE_LABELS: Record<GitHubItemState, string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
};

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function GitHubItemCard({ item }: { item: GitHubItem }) {
  const Icon = STATE_ICONS[item.state];
  return (
    <div className="group flex items-start gap-2.5 border-b border-border/30 px-3 py-2.5 hover:bg-surface-hover">
      <Icon size={14} className={cn('mt-0.5 shrink-0', STATE_STYLES[item.state])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-fg leading-tight">
            <span className="text-fg-faint">#{item.number}</span> {item.title}
          </p>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-fg-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
          >
            <ExternalLink size={11} />
          </a>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-faint">
          <span className="flex items-center gap-0.5">
            <User size={8} />
            {item.author}
          </span>
          <span>·</span>
          <span className="flex items-center gap-0.5">
            <Clock size={8} />
            {formatRelativeTime(item.createdAt)}
          </span>
          {item.commentCount > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-0.5">
                <MessageSquare size={8} />
                {item.commentCount}
              </span>
            </>
          )}
          {item.labels.map((label) => (
            <span key={label} className="rounded bg-surface px-1 py-0.5 text-[9px] text-fg-muted">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GitHubItemList({ items, loading = false, onRefresh }: GitHubItemListProps) {
  const [filter, setFilter] = useState<'all' | 'pull_request' | 'issue'>('all');
  const [stateFilter, setStateFilter] = useState<'all' | GitHubItemState>('all');

  const filtered = useMemo(() => {
    let result = items;
    if (filter !== 'all') {
      result = result.filter((i) => i.type === filter);
    }
    if (stateFilter !== 'all') {
      result = result.filter((i) => i.state === stateFilter);
    }
    return result;
  }, [items, filter, stateFilter]);

  return (
    <div className="flex h-full flex-col">
      {/* Filters */}
      <div className="flex items-center gap-1 border-b border-border px-3 pt-1">
        {(['all', 'pull_request', 'issue'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={cn(
              'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium capitalize transition-colors',
              filter === tab ? 'border-b-2 border-accent text-accent' : 'text-fg-muted hover:text-fg',
            )}
          >
            {tab === 'pull_request' ? 'PRs' : tab === 'issue' ? 'Issues' : 'All'}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-border" />
        {(['all', 'open', 'closed', 'merged'] as const).map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => setStateFilter(state)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              stateFilter === state ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-surface-hover hover:text-fg',
            )}
          >
            {state === 'all' ? 'All' : STATE_LABELS[state]}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <GitPullRequest size={28} className="mb-2 text-fg-faint" />
            <p className="text-xs text-fg-muted">No items found</p>
          </div>
        ) : (
          filtered.map((item) => (
            <GitHubItemCard key={`${item.type}-${item.id}`} item={item} />
          ))
        )}
      </div>
    </div>
  );
}
