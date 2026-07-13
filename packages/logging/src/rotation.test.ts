import { describe, expect, it } from 'vitest';
import { planLogRetention, shouldRotate, type LogFileStat } from './rotation';

describe('shouldRotate (spec 29.3: rotation)', () => {
  it('is false under the limit and true at/over it', () => {
    expect(shouldRotate(100, 1000)).toBe(false);
    expect(shouldRotate(999, 1000)).toBe(false);
    expect(shouldRotate(1000, 1000)).toBe(true);
    expect(shouldRotate(1001, 1000)).toBe(true);
  });
});

describe('planLogRetention (spec 29.3: bounded retention)', () => {
  function file(name: string, createdAtMs: number): LogFileStat {
    return { name, sizeBytes: 100, createdAtMs };
  }

  it('deletes nothing when under the cap', () => {
    const files = [file('a', 1), file('b', 2)];
    expect(planLogRetention(files, 5)).toEqual({ toDelete: [] });
  });

  it('deletes exactly the oldest files beyond the cap, never more', () => {
    const files = [file('newest', 5), file('oldest', 1), file('middle', 3), file('second-oldest', 2), file('second-newest', 4)];
    const plan = planLogRetention(files, 3);
    expect(plan.toDelete).toEqual(['oldest', 'second-oldest']);
  });
});
