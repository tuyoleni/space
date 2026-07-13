import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = new Date('2026-07-13T12:00:00.000Z');

describe('formatRelativeTime (spec 28: relative times expose exact accessible labels)', () => {
  it('always returns an exact label alongside the relative one', () => {
    const { relative, exact } = formatRelativeTime('2026-07-13T10:00:00.000Z', NOW);
    expect(relative).toBe('2 hours ago');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact).not.toBe(relative);
  });

  it('reports "just now" for anything under a minute', () => {
    expect(formatRelativeTime('2026-07-13T11:59:30.000Z', NOW).relative).toBe('just now');
  });

  it('pluralises correctly at exactly one unit', () => {
    expect(formatRelativeTime('2026-07-13T11:00:00.000Z', NOW).relative).toBe('1 hour ago');
    expect(formatRelativeTime('2026-07-12T12:00:00.000Z', NOW).relative).toBe('1 day ago');
  });

  it('handles a future timestamp distinctly from a past one', () => {
    expect(formatRelativeTime('2026-07-13T14:00:00.000Z', NOW).relative).toBe('in 2 hours');
  });

  it('falls back to the raw string for an unparsable timestamp rather than throwing', () => {
    const { relative, exact } = formatRelativeTime('not-a-date', NOW);
    expect(relative).toBe('not-a-date');
    expect(exact).toBe('not-a-date');
  });

  it('picks the largest applicable unit (years over months over days)', () => {
    expect(formatRelativeTime('2024-07-13T12:00:00.000Z', NOW).relative).toBe('2 years ago');
    expect(formatRelativeTime('2026-05-13T12:00:00.000Z', NOW).relative).toBe('2 months ago');
  });
});
