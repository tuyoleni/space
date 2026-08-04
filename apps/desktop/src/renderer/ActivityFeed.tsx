/**
 * Activity Feed: shows a chronological list of workspace events like
 * git commits, terminal sessions, project changes, and builds.
 * Compact, scannable format with relative timestamps.
 */
import { useMemo, useState } from 'react';
import {
  GitCommitHorizontal,
  Terminal,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
} from 'lucide-react';
import { cn } from '@space/ui';

export type ActivityType = 'commit' | 'terminal' | 'project' | 'git' | 'build' | 'deploy';

export interface ActivityItem {
  readonly id: string;
  readonly type: ActivityType;
  readonly title: string;
  readonly description?: string;
  readonly timestamp: Date;
  readonly status?: 'success' | 'error' | 'running';
  readonly project?: string;
}

interface ActivityFeedProps {
  readonly items: readonly ActivityItem[];
  readonly maxItems?: number;
}

const TYPE_ICONS: Record<ActivityType, typeof GitCommitHorizontal> = {
  commit: GitCommitHorizontal,
  terminal: Terminal,
  project: FolderOpen,
  git: GitBranch,
  build: GitPullRequest,
  deploy: Play,
};

const TYPE_COLORS: Record<ActivityType, string> = {
  commit: 'text-accent',
  terminal: 'text-success',
  project: 'text-warning',
  git: 'text-purple-400',
  build: 'text-blue-400',
  deploy: 'text-green-400',
};

const STATUS_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  running: Clock,
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export function ActivityFeed({ items, maxItems = 20 }: ActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');

  const filtered = useMemo(() => {
    let result = items;
    if (filter !== 'all') {
      result = result.filter((i) => i.type === filter);
    }
    return result.slice(0, maxItems);
  }, [items, filter, maxItems]);

  return (
    <div className="flex h-full flex-col">
      {/* Filter */}
      <div className="flex items-center gap-1 border-b border-border px-3 pt-1">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn(
            'rounded px-1.5 py-1 text-[10px] font-medium transition-colors',
            filter === 'all' ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-surface-hover',
          )}
        >
          All
        </button>
        {(['commit', 'terminal', 'project', 'build'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilter(type)}
            className={cn(
              'rounded px-1.5 py-1 text-[10px] font-medium capitalize transition-colors',
              filter === type ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-surface-hover',
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock size={24} className="mb-2 text-fg-faint" />
            <p className="text-xs text-fg-muted">No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((item) => {
              const TypeIcon = TYPE_ICONS[item.type];
              const StatusIcon = item.status ? STATUS_ICONS[item.status] : null;
              return (
                <div key={item.id} className="flex items-start gap-2.5 px-3 py-2 hover:bg-surface-hover">
                  <TypeIcon size={13} className={cn('mt-0.5 shrink-0', TYPE_COLORS[item.type])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-fg truncate">{item.title}</p>
                      {StatusIcon && (
                        <StatusIcon
                          size={10}
                          className={cn(
                            item.status === 'success' && 'text-success',
                            item.status === 'error' && 'text-danger',
                            item.status === 'running' && 'text-warning animate-pulse',
                          )}
                        />
                      )}
                    </div>
                    {item.description && (
                      <p className="mt-0.5 truncate text-[10px] text-fg-faint">{item.description}</p>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-fg-faint">
                      <span>{formatRelativeTime(item.timestamp)}</span>
                      {item.project && (
                        <>
                          <span>·</span>
                          <span>{item.project}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
