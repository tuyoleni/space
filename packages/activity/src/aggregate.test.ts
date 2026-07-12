import { describe, expect, it } from 'vitest';
import { buildWeekGrid, dailyDetail, dayCellAriaLabel, toDateKey } from './aggregate';
import type { ActivityEvent } from './types';

function event(overrides: Partial<ActivityEvent> & { occurredAt: string }): ActivityEvent {
  return {
    id: overrides.id ?? `evt-${Math.random()}`,
    workspaceId: overrides.workspaceId ?? 'ws-1',
    projectId: overrides.projectId ?? 'proj-1',
    eventType: overrides.eventType ?? 'commit',
    subjectRef: overrides.subjectRef ?? null,
    summary: overrides.summary ?? 'did a thing',
    weight: overrides.weight ?? 1,
    metadata: overrides.metadata ?? null,
    occurredAt: overrides.occurredAt,
  };
}

describe('toDateKey', () => {
  it('extracts the UTC calendar date from an ISO timestamp', () => {
    expect(toDateKey('2026-07-12T23:59:59.000Z')).toBe('2026-07-12');
  });

  it('rejects a malformed timestamp rather than silently truncating garbage', () => {
    expect(() => toDateKey('not-a-date')).toThrow();
  });
});

describe('buildWeekGrid (spec 17.2 ACT-002)', () => {
  it('renders exactly the requested number of complete 7-day weeks', () => {
    const grid = buildWeekGrid([], { weekCount: 52, referenceDate: '2026-07-12T12:00:00.000Z' });
    expect(grid.weeks).toHaveLength(52);
    for (const week of grid.weeks) {
      expect(week.days).toHaveLength(7);
    }
  });

  it('aligns every week column to start on a Sunday and end on a Saturday', () => {
    const grid = buildWeekGrid([], { weekCount: 52, referenceDate: '2026-07-12T12:00:00.000Z' });
    for (const week of grid.weeks) {
      const first = new Date(`${week.days[0]?.date}T00:00:00.000Z`);
      const last = new Date(`${week.days[6]?.date}T00:00:00.000Z`);
      expect(first.getUTCDay()).toBe(0);
      expect(last.getUTCDay()).toBe(6);
    }
  });

  it('marks days after the reference date as future padding, never counted as activity', () => {
    const grid = buildWeekGrid([], { weekCount: 1, referenceDate: '2026-07-08T00:00:00.000Z' });
    const referenceCell = grid.weeks[0]?.days.find((d) => d.date === '2026-07-08');
    const futureCell = grid.weeks[0]?.days.find((d) => d.date === '2026-07-09');
    expect(referenceCell?.isFuture).toBe(false);
    expect(futureCell?.isFuture).toBe(true);
  });

  it('sums weight (not raw count) per day and scales intensity relative to the busiest day', () => {
    const events = [
      event({ occurredAt: '2026-07-10T09:00:00.000Z', weight: 3 }), // commit-weight day
      event({ occurredAt: '2026-07-10T10:00:00.000Z', weight: 3 }),
      event({ occurredAt: '2026-07-11T09:00:00.000Z', weight: 1 }),
    ];
    const grid = buildWeekGrid(events, { weekCount: 2, referenceDate: '2026-07-12T00:00:00.000Z' });
    const busyDay = grid.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-07-10');
    const quietDay = grid.weeks.flatMap((w) => w.days).find((d) => d.date === '2026-07-11');
    expect(busyDay?.count).toBe(2);
    expect(busyDay?.weight).toBe(6);
    expect(busyDay?.intensityLevel).toBe(4);
    expect(quietDay?.weight).toBe(1);
    expect(quietDay?.intensityLevel).toBeLessThan(4);
  });

  it('leaves every cell at intensity 0 when there is no activity at all', () => {
    const grid = buildWeekGrid([], { weekCount: 3, referenceDate: '2026-07-12T00:00:00.000Z' });
    for (const cell of grid.weeks.flatMap((w) => w.days)) {
      expect(cell.intensityLevel).toBe(0);
    }
  });
});

describe('dayCellAriaLabel', () => {
  it('describes an empty past day, an active day, and a future day distinctly', () => {
    // 2026-07-10 is a Friday, so its week (Sun 07-05 .. Sat 07-11) still has
    // 07-11 as unreached future padding inside the same visible grid.
    const grid = buildWeekGrid(
      [event({ occurredAt: '2026-07-10T09:00:00.000Z' })],
      { weekCount: 1, referenceDate: '2026-07-10T00:00:00.000Z' },
    );
    const cells = grid.weeks[0]?.days ?? [];
    const active = cells.find((c) => c.date === '2026-07-10');
    const empty = cells.find((c) => c.date === '2026-07-09');
    const future = cells.find((c) => c.date === '2026-07-11');
    expect(dayCellAriaLabel(active!)).toContain('1 event');
    expect(dayCellAriaLabel(empty!)).toContain('no activity');
    expect(dayCellAriaLabel(future!)).toContain('no data yet');
  });
});

describe('dailyDetail (spec 17.3 ACT-003)', () => {
  it('groups a single day’s events by workspace then project, ordered oldest-first within a group', () => {
    const events = [
      event({ id: 'a', occurredAt: '2026-07-10T09:00:00.000Z', workspaceId: 'ws-1', projectId: 'p-1' }),
      event({ id: 'b', occurredAt: '2026-07-10T08:00:00.000Z', workspaceId: 'ws-1', projectId: 'p-1' }),
      event({ id: 'c', occurredAt: '2026-07-10T09:30:00.000Z', workspaceId: 'ws-1', projectId: 'p-2' }),
      event({ id: 'd', occurredAt: '2026-07-11T09:00:00.000Z', workspaceId: 'ws-1', projectId: 'p-1' }),
    ];
    const groups = dailyDetail(events, '2026-07-10T00:00:00.000Z');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.projectId).toBe('p-1');
    expect(groups[0]?.events.map((e) => e.id)).toEqual(['b', 'a']);
    expect(groups[1]?.projectId).toBe('p-2');
  });

  it('excludes events from other days', () => {
    const events = [
      event({ id: 'a', occurredAt: '2026-07-10T09:00:00.000Z' }),
      event({ id: 'b', occurredAt: '2026-07-11T09:00:00.000Z' }),
    ];
    expect(dailyDetail(events, '2026-07-10T00:00:00.000Z')).toHaveLength(1);
  });
});
