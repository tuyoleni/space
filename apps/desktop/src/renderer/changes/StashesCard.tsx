import { Archive, GitBranch } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardRows, CardTitle, formatRelativeTime } from '@space/ui';

export interface StashEntry {
  readonly index: number;
  readonly message: string;
  readonly branch: string | null;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

export interface StashesCardProps {
  readonly stashes: readonly StashEntry[];
  readonly onApply: (index: number) => void;
  readonly onDrop: (index: number) => void;
  readonly busy: boolean;
}

/**
 * A list of git stashes with per-row Apply / Drop actions. Reuses the lined
 * `CardRows` list; each row shows the `stash@{n}` index, the stash message,
 * its originating branch, and when it was created. Actions are prop callbacks
 * and `busy` disables them while a stash operation is running.
 */
export function StashesCard({ stashes, onApply, onDrop, busy }: StashesCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Stashes</CardTitle>
        <Badge variant={stashes.length > 0 ? 'accent' : 'neutral'}>{stashes.length}</Badge>
      </CardHeader>
      {stashes.length === 0 ? (
        <CardContent className="flex-1">
          <p className="text-sm text-fg-faint">No stashes.</p>
        </CardContent>
      ) : (
        <CardRows className="max-h-64 overflow-y-auto">
          {stashes.map((stash) => {
            const when = formatRelativeTime(new Date(stash.createdAt).toISOString());
            return (
              <div key={stash.index} className="flex items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Archive size={14} className="shrink-0 text-fg-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">
                      <span className="text-fg-faint">stash@{'{'}
                      {stash.index}
                      {'}'}</span> {stash.message}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-fg-faint">
                      {stash.branch && (
                        <>
                          <GitBranch size={11} /> {stash.branch} ·{' '}
                        </>
                      )}
                      <time dateTime={new Date(stash.createdAt).toISOString()} title={when.exact}>
                        {when.relative}
                      </time>
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onApply(stash.index)} disabled={busy}>
                    Apply
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDrop(stash.index)} disabled={busy}>
                    Drop
                  </Button>
                </span>
              </div>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}
