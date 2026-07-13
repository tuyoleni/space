import { describe, expect, it } from 'vitest';
import { applyUserChoice, type UpdateLifecycleState } from './decision';

const readyState: Extract<UpdateLifecycleState, { kind: 'ready-to-apply' }> = { kind: 'ready-to-apply', version: '1.2.3' };

describe('applyUserChoice (spec 31.3: "allow defer/restart-later behaviour")', () => {
  it('apply-now transitions to applying', () => {
    expect(applyUserChoice(readyState, 'apply-now', () => '2026-07-13T00:00:00.000Z')).toEqual({ kind: 'applying', version: '1.2.3' });
  });

  it('restart-later also transitions to applying (same mechanics, different UI timing)', () => {
    expect(applyUserChoice(readyState, 'restart-later', () => '2026-07-13T00:00:00.000Z')).toEqual({ kind: 'applying', version: '1.2.3' });
  });

  it('defer transitions to deferred, stamped with the deferral time, and never applies anything', () => {
    const result = applyUserChoice(readyState, 'defer', () => '2026-07-13T00:00:00.000Z');
    expect(result).toEqual({ kind: 'deferred', version: '1.2.3', deferredAt: '2026-07-13T00:00:00.000Z' });
  });
});
