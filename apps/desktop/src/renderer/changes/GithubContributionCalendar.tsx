import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import type { GithubContributionCalendar, GithubContributionDay } from '@space/contracts';
import { Button, Card, CardContent, CardHeader } from '@space/ui';

const LEVEL_CLASS: Record<string, string> = {
  NONE: 'bg-surface-raised',
  FIRST_QUARTILE: 'bg-success/30',
  SECOND_QUARTILE: 'bg-success/50',
  THIRD_QUARTILE: 'bg-success/70',
  FOURTH_QUARTILE: 'bg-success',
};

const WEEKDAY_LABELS: Readonly<Record<number, string>> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

interface ContributionWeek {
  readonly monthLabel: string | null;
  readonly days: readonly (GithubContributionDay | null)[];
}

/** GitHub returns shortened first/last weeks. Restore their true weekday
 * positions so cells never shift into a neighbouring week. */
function buildWeeks(calendar: GithubContributionCalendar): readonly ContributionWeek[] {
  let previousMonth: number | null = null;
  return calendar.weeks.map((week) => {
    const days: (GithubContributionDay | null)[] = Array.from({ length: 7 }, () => null);
    for (const day of week) {
      const date = new Date(`${day.date}T00:00:00Z`);
      days[date.getUTCDay()] = day;
    }
    const firstDay = week[0];
    const date = firstDay ? new Date(`${firstDay.date}T00:00:00Z`) : null;
    const month = date?.getUTCMonth() ?? null;
    const monthLabel = date !== null && month !== previousMonth
      ? new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(date)
      : null;
    previousMonth = month;
    return { monthLabel, days };
  });
}

interface GithubContributionCalendarProps {
  readonly projectId: string;
  /** Use inside the existing commit-history card instead of creating a second dashboard card. */
  readonly embedded?: boolean;
}

export function GithubContributionCalendar({ projectId, embedded = false }: GithubContributionCalendarProps) {
  const [calendar, setCalendar] = useState<GithubContributionCalendar | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCalendar(await window.space.github.contributions({ projectId }));
    } catch {
      setCalendar(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  const weeks = useMemo(() => (calendar ? buildWeeks(calendar) : []), [calendar]);

  const toolbar = (
    <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays size={15} className="text-fg-muted" />
          <span className="text-sm font-semibold text-fg">Project activity</span>
          {calendar ? <span className="truncate text-xs text-fg-muted">{calendar.totalContributions.toLocaleString()} commits across all history · {calendar.projectName}</span> : null}
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Refresh GitHub activity" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
        </Button>
    </div>
  );

  const calendarBody = (
    <div className={embedded ? 'pt-2.5' : undefined}>
        {calendar === undefined ? (
          <div className="h-[74px] animate-pulse rounded bg-surface-raised" />
        ) : calendar === null ? (
          <p className="text-sm text-fg-muted">This project has no Git history to show yet.</p>
        ) : (
          <div className="overflow-x-auto pb-1" aria-label={`${calendar.totalContributions} GitHub contributions in the past year`}>
            <div className="w-max">
              <div className="mb-1 ml-7 flex h-3 gap-1">
                {weeks.map((week, index) => (
                  <div key={`${index}-${week.monthLabel ?? 'week'}`} className="relative h-3 w-3 shrink-0">
                    {week.monthLabel && <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-3 text-fg-faint">{week.monthLabel}</span>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex w-5 shrink-0 flex-col gap-1 text-[10px] leading-3 text-fg-faint">
                  {Array.from({ length: 7 }, (_, dayIndex) => <span key={dayIndex} className="h-3">{WEEKDAY_LABELS[dayIndex] ?? ''}</span>)}
                </div>
                <div className="flex gap-1">
                  {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="flex w-3 shrink-0 flex-col gap-1">
                      {week.days.map((day, dayIndex) => (
                        day ? (
                          <span
                            key={day.date}
                            title={`${day.date}: ${day.count} contribution${day.count === 1 ? '' : 's'}`}
                            className={`h-3 w-3 rounded-[3px] ${LEVEL_CLASS[day.level] ?? LEVEL_CLASS.NONE}`}
                          />
                        ) : <span key={`${weekIndex}-${dayIndex}`} className="h-3 w-3" aria-hidden />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-fg-faint">
                <span>Less</span>
                {Object.keys(LEVEL_CLASS).map((level) => <span key={level} className={`h-3 w-3 rounded-[3px] ${LEVEL_CLASS[level]}`} />)}
                <span>More</span>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  if (embedded) {
    return <div className="border-b border-border px-3.5 py-2.5">{toolbar}{calendarBody}</div>;
  }

  return (
    <Card>
      <CardHeader>{toolbar}</CardHeader>
      <CardContent className="py-2.5">{calendarBody}</CardContent>
    </Card>
  );
}
