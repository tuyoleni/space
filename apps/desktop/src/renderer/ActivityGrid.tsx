import { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent } from '@space/contracts';
import { buildWeekGrid, dailyDetail, dayCellAriaLabel, type DayCell } from '@space/activity';

/**
 * Minimal 52-week activity grid and daily detail (spec 17.2/17.3
 * ACT-002/003). Fetches raw events for the active workspace over IPC and
 * reuses @space/activity's pure aggregation (buildWeekGrid/dailyDetail) —
 * both browser-safe (no I/O), so the renderer never re-implements the
 * grid math. Colors are intensity-level buckets only (0-4), never a raw
 * count, per spec 17.2's "avoid equating raw keystrokes... with
 * meaningful productivity".
 */
interface ActivityGridProps {
  readonly workspaceId: string;
}

const INTENSITY_COLOR = ['#2d2d2d', '#0e4429', '#006d32', '#26a641', '#39d353'];

export function ActivityGrid({ workspaceId }: ActivityGridProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 371 * 24 * 60 * 60 * 1000).toISOString();
    void window.space.activity
      .listRange({ workspaceId, fromInclusive: from, toInclusive: now.toISOString() })
      .then(setEvents);
  }, [workspaceId]);

  const grid = useMemo(() => buildWeekGrid(events, { weekCount: 52, referenceDate: new Date().toISOString() }), [events]);
  const detail = useMemo(() => (selectedDate ? dailyDetail(events, selectedDate) : []), [events, selectedDate]);

  function cellStyle(cell: DayCell): React.CSSProperties {
    return {
      width: 10,
      height: 10,
      margin: 1,
      borderRadius: 2,
      background: cell.isFuture ? 'transparent' : INTENSITY_COLOR[cell.intensityLevel],
      cursor: cell.isFuture ? 'default' : 'pointer',
    };
  }

  return (
    <section>
      <h2>Activity</h2>
      <div style={{ display: 'flex', overflowX: 'auto' }} role="img" aria-label="52-week activity grid">
        {grid.weeks.map((week, weekIndex) => (
          <div key={weekIndex} style={{ display: 'flex', flexDirection: 'column' }}>
            {week.days.map((cell) => (
              <div
                key={cell.date}
                title={dayCellAriaLabel(cell)}
                aria-label={dayCellAriaLabel(cell)}
                style={cellStyle(cell)}
                onClick={() => !cell.isFuture && setSelectedDate(cell.date)}
              />
            ))}
          </div>
        ))}
      </div>

      {selectedDate && (
        <div style={{ marginTop: '0.5rem' }}>
          <strong>{selectedDate}</strong>
          {detail.length === 0 ? (
            <p>No activity.</p>
          ) : (
            detail.map((group) => (
              <div key={`${group.workspaceId}::${group.projectId ?? ''}`} style={{ marginTop: '0.25rem' }}>
                <em>{group.projectId ?? 'workspace-level'}</em>
                <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem' }}>
                  {group.events.map((event) => (
                    <li key={event.id}>
                      {event.summary}
                      {event.subjectRef ? ` (${event.subjectRef})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
