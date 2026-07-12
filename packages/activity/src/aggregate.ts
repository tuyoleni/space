/**
 * 52-week grid and daily detail aggregation (spec 17.2 ACT-002, 17.3
 * ACT-003). Pure functions over an already-loaded `ActivityEvent[]` — no
 * I/O, no Date.now() calls hidden inside (a `referenceDate` is always
 * passed in), so this stays fully deterministic and testable without a
 * real clock or database.
 *
 * Days are bucketed by their UTC calendar date. `occurredAt` is always an
 * ISO-8601 timestamp (spec 23.2.9), so slicing the first 10 characters
 * ("YYYY-MM-DD") is exact and avoids pulling in a timezone library for a
 * v1 that is explicitly local-only (spec 17.4).
 */
import type { ActivityEvent } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toDateKey(isoTimestamp: string): string {
  const key = isoTimestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`"${isoTimestamp}" is not a valid ISO-8601 timestamp`);
  }
  return key;
}

function dateKeyToUtcMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`);
}

function addDays(dateKey: string, days: number): string {
  const next = new Date(dateKeyToUtcMs(dateKey) + days * MS_PER_DAY);
  return next.toISOString().slice(0, 10);
}

/** 0 (Sunday) .. 6 (Saturday), matching the grid's weekday rows. */
function weekdayIndex(dateKey: string): number {
  return new Date(dateKeyToUtcMs(dateKey)).getUTCDay();
}

export interface DayCell {
  readonly date: string;
  /** Raw event count for the day — shown alongside weight, never used alone for intensity (spec 17.2). */
  readonly count: number;
  /** Sum of each event's meaningful-activity weight for the day. */
  readonly weight: number;
  /** 0 (no activity) through 4 (busiest), scaled relative to the busiest day in this grid. */
  readonly intensityLevel: 0 | 1 | 2 | 3 | 4;
  /** Only populated for days on/before `referenceDate`; future padding days are never marked active. */
  readonly isFuture: boolean;
}

export interface WeekColumn {
  readonly days: readonly DayCell[];
}

export interface WeekGrid {
  readonly weeks: readonly WeekColumn[];
  readonly startDate: string;
  readonly endDate: string;
}

export interface BuildWeekGridOptions {
  readonly weekCount?: number;
  /** ISO date/timestamp the grid ends on; defaults to "today" if the caller omits it, but tests should always pass one. */
  readonly referenceDate: string;
}

function intensityLevel(weight: number, maxWeight: number): 0 | 1 | 2 | 3 | 4 {
  if (weight <= 0 || maxWeight <= 0) {
    return 0;
  }
  const ratio = weight / maxWeight;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Builds a complete `weekCount`-week grid ending on `referenceDate`,
 * aligned so every column is a real Sunday-through-Saturday week (spec
 * 17.2: "show month and weekday alignment correctly"). Days after
 * `referenceDate` that fall inside the final week are included as empty
 * future padding so the grid is always visually complete, but are marked
 * `isFuture` so the renderer never implies activity that hasn't happened.
 */
export function buildWeekGrid(events: readonly ActivityEvent[], options: BuildWeekGridOptions): WeekGrid {
  const weekCount = options.weekCount ?? 52;
  const referenceKey = toDateKey(options.referenceDate);
  const endOfReferenceWeek = addDays(referenceKey, 6 - weekdayIndex(referenceKey));
  const startDate = addDays(endOfReferenceWeek, -(weekCount * 7 - 1));

  const byDate = new Map<string, { count: number; weight: number }>();
  for (const event of events) {
    const key = toDateKey(event.occurredAt);
    const bucket = byDate.get(key) ?? { count: 0, weight: 0 };
    bucket.count += 1;
    bucket.weight += event.weight;
    byDate.set(key, bucket);
  }
  const maxWeight = Math.max(0, ...[...byDate.values()].map((b) => b.weight));

  const weeks: WeekColumn[] = [];
  let cursor = startDate;
  for (let week = 0; week < weekCount; week += 1) {
    const days: DayCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const bucket = byDate.get(cursor) ?? { count: 0, weight: 0 };
      days.push({
        date: cursor,
        count: bucket.count,
        weight: bucket.weight,
        intensityLevel: intensityLevel(bucket.weight, maxWeight),
        isFuture: cursor > referenceKey,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push({ days });
  }

  return { weeks, startDate, endDate: addDays(startDate, weekCount * 7 - 1) };
}

/** Accessible label for a single grid cell (spec 17.2: "provide accessible labels and day detail"). */
export function dayCellAriaLabel(cell: DayCell): string {
  if (cell.isFuture) {
    return `${cell.date}: no data yet`;
  }
  if (cell.count === 0) {
    return `${cell.date}: no activity`;
  }
  return `${cell.date}: ${cell.count} event${cell.count === 1 ? '' : 's'}`;
}

export interface DailyDetailGroup {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly events: readonly ActivityEvent[];
}

/**
 * Groups a single day's events by workspace then project (spec 17.3:
 * "events grouped by workspace and project"), each group's events ordered
 * oldest-first, groups ordered by their first event's time.
 */
export function dailyDetail(events: readonly ActivityEvent[], date: string): readonly DailyDetailGroup[] {
  const dateKey = toDateKey(date);
  const matching = events
    .filter((event) => toDateKey(event.occurredAt) === dateKey)
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const groups = new Map<string, DailyDetailGroup>();
  const order: string[] = [];
  for (const event of matching) {
    const key = `${event.workspaceId}::${event.projectId ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, events: [...existing.events, event] });
    } else {
      order.push(key);
      groups.set(key, { workspaceId: event.workspaceId, projectId: event.projectId, events: [event] });
    }
  }
  return order.map((key) => groups.get(key) as DailyDetailGroup);
}
