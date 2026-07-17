import { GitPullRequest } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardRows, CardTitle, formatRelativeTime } from '@space/ui';

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';

export interface PullRequestRow {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly headRef?: string;
  readonly baseRef?: string;
  readonly state?: PullRequestState;
  /** Epoch milliseconds or an ISO-8601 string. */
  readonly updatedAt: number | string;
}

export interface ActivePullRequestsCardProps {
  readonly prs: readonly PullRequestRow[];
}

const STATE_VARIANT: Record<PullRequestState, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  open: 'success',
  draft: 'neutral',
  merged: 'accent',
  closed: 'danger',
};

function toIso(at: number | string): string {
  return typeof at === 'number' ? new Date(at).toISOString() : at;
}

/**
 * Active pull requests, using the same PR-row look as HomeView's GitHub card:
 * an accent pull-request glyph, the `#number` in faint plus the title, and a
 * secondary line with the author, branch flow, and relative update time. An
 * optional state badge (open/draft/merged/closed) sits on the right.
 */
export function ActivePullRequestsCard({ prs }: ActivePullRequestsCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Active Pull Requests</CardTitle>
        <Badge variant={prs.length > 0 ? 'accent' : 'neutral'}>{prs.length}</Badge>
      </CardHeader>
      {prs.length === 0 ? (
        <CardContent className="flex-1">
          <p className="text-sm text-fg-faint">No open pull requests.</p>
        </CardContent>
      ) : (
        <CardRows className="max-h-64 overflow-y-auto">
          {prs.map((pr) => {
            const iso = toIso(pr.updatedAt);
            const when = formatRelativeTime(iso);
            const flow = pr.headRef && pr.baseRef ? `${pr.headRef} → ${pr.baseRef}` : pr.headRef ?? null;
            return (
              <div key={pr.number} className="flex items-center gap-2.5 py-2">
                <GitPullRequest size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    <span className="text-fg-faint">#{pr.number}</span> {pr.title}
                  </span>
                  <span className="block truncate text-[11px] text-fg-faint">
                    {pr.author}
                    {flow ? ` · ${flow}` : ''} · {when.relative}
                  </span>
                </span>
                {pr.state && <Badge variant={STATE_VARIANT[pr.state]}>{pr.state}</Badge>}
              </div>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}
