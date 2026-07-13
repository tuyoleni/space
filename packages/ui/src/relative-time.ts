/**
 * Pure relative-time formatting (spec section 28: "Relative times expose
 * exact accessible labels"). Returns both a short human relative string
 * (e.g. "2 hours ago") and a full, unambiguous exact timestamp a caller
 * must also expose (as a `title`/`aria-label`, never relative-only) —
 * screen-reader and low-vision users must never be left with only the
 * relative string, and a sighted user hovering must be able to see the
 * real date/time too. No DOM/React dependency, so this is testable under
 * Node like every other pure `@space/*` module, independent of the
 * renderer's own JSX rendering of it.
 */
export interface RelativeTimeLabel {
  readonly relative: string;
  readonly exact: string;
}

const UNITS: ReadonlyArray<{ readonly unit: string; readonly ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

/** `now` is injectable so this stays deterministic under test, the same "clock as a parameter" pattern every other `@space/*` package uses. */
export function formatRelativeTime(iso: string, now: Date = new Date()): RelativeTimeLabel {
  const then = new Date(iso);
  const exact = Number.isNaN(then.getTime()) ? iso : then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (Number.isNaN(then.getTime())) {
    return { relative: iso, exact };
  }

  const diffMs = now.getTime() - then.getTime();
  const diffAbs = Math.abs(diffMs);

  if (diffAbs < 60_000) {
    return { relative: 'just now', exact };
  }

  for (const { unit, ms } of UNITS) {
    if (diffAbs >= ms) {
      const value = Math.floor(diffAbs / ms);
      const plural = value === 1 ? unit : `${unit}s`;
      const relative = diffMs >= 0 ? `${value} ${plural} ago` : `in ${value} ${plural}`;
      return { relative, exact };
    }
  }

  return { relative: 'just now', exact };
}
