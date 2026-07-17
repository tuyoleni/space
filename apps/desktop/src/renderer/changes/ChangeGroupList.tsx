import { ChevronRight, FileDiff } from 'lucide-react';
import { Badge, Card, CardContent, Checkbox, cn } from '@space/ui';

export type ChangeGroupSource = 'rule' | 'model' | 'user';

export interface ChangeGroupItem {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly generatedBy: ChangeGroupSource;
  /** 0..1 model confidence; a low value surfaces a warning badge. */
  readonly confidence: number;
  readonly added: number;
  readonly removed: number;
  readonly fileCount: number;
  readonly anyStaged: boolean;
}

export interface ChangeGroupListProps {
  readonly groups: readonly ChangeGroupItem[];
  readonly selectedGroupId: string | null;
  readonly includedGroupIds: ReadonlySet<string>;
  readonly onSelectGroup: (id: string) => void;
  readonly onToggleIncluded: (id: string) => void;
}

const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * The intent change-group cards, laid out as an equal-height responsive grid
 * that mirrors the Home screen's card grid (`auto-rows-fr` + `grid-cols-3`) —
 * compact, uniform tiles rather than a tall column of stacked cards. Each tile
 * carries the checkbox, title, "Staged / Not staged" badge, a one-line
 * explanation, the source badge, an optional low-confidence badge, and the
 * +added/−removed/N-files summary. All totals arrive as props (computed from
 * real diff stats). Selecting a tile drives the shared diff panel below the grid.
 */
export function ChangeGroupList({
  groups,
  selectedGroupId,
  includedGroupIds,
  onSelectGroup,
  onToggleIncluded,
}: ChangeGroupListProps) {
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const included = includedGroupIds.has(group.id);
        const selected = group.id === selectedGroupId;
        return (
          <Card
            key={group.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            className={cn(
              'cursor-pointer transition-colors hover:border-border-strong',
              selected ? 'border-accent bg-surface-hover/40' : 'border-border',
            )}
            onClick={() => onSelectGroup(group.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectGroup(group.id);
              }
            }}
          >
            <CardContent className="flex items-start gap-2.5 py-3">
              {/* Stop propagation so ticking "include" doesn't also re-select the row. */}
              <span onClick={(event) => event.stopPropagation()} className="mt-0.5">
                <Checkbox
                  checked={included}
                  onCheckedChange={() => onToggleIncluded(group.id)}
                  aria-label={`Include "${group.title}" in commit`}
                />
              </span>
              <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                <FileDiff size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{group.title}</span>
                  <span className="shrink-0 text-xs">
                    <span className="text-success">+{group.added}</span> <span className="text-danger">−{group.removed}</span>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-fg-muted">{group.explanation}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant={group.anyStaged ? 'success' : 'neutral'}>{group.anyStaged ? 'Staged' : 'Not staged'}</Badge>
                  <Badge>{group.generatedBy}</Badge>
                  {group.confidence < LOW_CONFIDENCE_THRESHOLD && (
                    <Badge variant="warning">{Math.round(group.confidence * 100)}%</Badge>
                  )}
                  <span className="text-fg-faint">
                    {group.fileCount} file{group.fileCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <ChevronRight size={15} className="mt-1 shrink-0 text-fg-faint" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
