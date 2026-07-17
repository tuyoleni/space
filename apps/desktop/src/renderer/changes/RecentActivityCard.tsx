import {
  GitCommit,
  GitBranch,
  GitMerge,
  GitPullRequest,
  History,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardRows, CardTitle, formatRelativeTime } from '@space/ui';

export type ActivityKind = 'commit' | 'push' | 'pull' | 'merge' | 'branch' | 'stash' | 'other';

export interface ActivityEvent {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly label: string;
  readonly detail?: string;
  /** Epoch milliseconds or an ISO-8601 string. */
  readonly at: number | string;
}

export interface RecentActivityCardProps {
  readonly events: readonly ActivityEvent[];
}

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  commit: GitCommit,
  push: Upload,
  pull: GitMerge,
  merge: GitMerge,
  branch: GitBranch,
  stash: History,
  other: GitPullRequest,
};

function toIso(at: number | string): string {
  return typeof at === 'number' ? new Date(at).toISOString() : at;
}

/**
 * A recent-activity feed card — one lined row per git event, newest first (the
 * wiring worker sorts). Mirrors HomeView's activity-row look: a small muted
 * glyph, a primary label, an optional secondary detail, and an accessible
 * relative timestamp with the exact time on hover.
 */
export function RecentActivityCard({ events }: RecentActivityCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      {events.length === 0 ? (
        <CardContent className="flex-1">
          <p className="text-sm text-fg-faint">No recent activity.</p>
        </CardContent>
      ) : (
        <CardRows className="max-h-64 overflow-y-auto">
          {events.map((event) => {
            const Icon = KIND_ICON[event.kind];
            const iso = toIso(event.at);
            const when = formatRelativeTime(iso);
            return (
              <div key={event.id} className="flex items-center gap-2.5 py-2">
                <Icon size={14} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{event.label}</span>
                  {event.detail && <span className="block truncate text-[11px] text-fg-faint">{event.detail}</span>}
                </span>
                <time className="shrink-0 text-xs text-fg-faint" dateTime={iso} title={when.exact}>
                  {when.relative}
                </time>
              </div>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}
