import { Badge, Select, Tabs, TabsList, TabsTrigger, cn } from '@space/ui';

export type ChangesTab = 'groups' | 'files';
export type ChangesFilter = 'all' | 'staged' | 'unstaged' | 'conflicts';

export interface ChangesGroupByOption {
  readonly value: string;
  readonly label: string;
}

export interface ChangesToolbarTabsProps {
  readonly tab: ChangesTab;
  readonly onTabChange: (tab: ChangesTab) => void;
  readonly filter: ChangesFilter;
  readonly onFilterChange: (filter: ChangesFilter) => void;
  readonly counts: Record<ChangesFilter, number>;
  readonly groupBy: string;
  readonly groupByOptions: readonly ChangesGroupByOption[];
  readonly onGroupByChange: (value: string) => void;
}

const FILTERS: readonly { readonly value: ChangesFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'staged', label: 'Staged' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'conflicts', label: 'Conflicts' },
];

/**
 * The toolbar above the change area: a two-tab strip (Change Groups | File
 * Explorer) reusing the shared `Tabs` underline, a set of filter chips with
 * live counts, and a "Group by" `Select`. Purely a controlled selector — it
 * owns no data, only surfaces the current tab/filter/grouping and calls back.
 */
export function ChangesToolbarTabs({
  tab,
  onTabChange,
  filter,
  onFilterChange,
  counts,
  groupBy,
  groupByOptions,
  onGroupByChange,
}: ChangesToolbarTabsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <Tabs value={tab} onValueChange={(next) => onTabChange(next as ChangesTab)}>
        <TabsList className="border-b-0">
          <TabsTrigger value="groups">Change Groups</TabsTrigger>
          <TabsTrigger value="files">File Explorer</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3 pb-2">
        <div className="flex items-center gap-1">
          {FILTERS.map((entry) => {
            const active = entry.value === filter;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => onFilterChange(entry.value)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-border bg-surface-hover text-fg'
                    : 'border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {entry.label}
                <Badge variant={active ? 'accent' : 'neutral'}>{counts[entry.value]}</Badge>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-fg-muted">Group by</span>
          <Select
            ariaLabel="Group changes by"
            value={groupBy}
            onValueChange={onGroupByChange}
            options={groupByOptions}
            className="h-8"
          />
        </div>
      </div>
    </div>
  );
}
