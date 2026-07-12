import { describe, expect, it } from 'vitest';
import {
  assertDraftReviewedBeforeSubmit,
  createDraftRemoteMutation,
  DraftNotReviewedError,
  labelWithLastRefresh,
  markDraftReviewed,
  remoteActionAvailability,
} from './connectivity';

describe('labelWithLastRefresh', () => {
  it('pairs data with its refresh timestamp', () => {
    expect(labelWithLastRefresh(['a'], '2026-07-12T10:00:00Z')).toEqual({ data: ['a'], lastRefreshedAt: '2026-07-12T10:00:00Z' });
  });
});

describe('remoteActionAvailability', () => {
  it('is available with no reason when online', () => {
    expect(remoteActionAvailability('online')).toEqual({ available: true, reason: null });
  });

  it('is unavailable with a clear reason when degraded or offline', () => {
    expect(remoteActionAvailability('offline').available).toBe(false);
    expect(remoteActionAvailability('offline').reason).toMatch(/unreachable/);
    expect(remoteActionAvailability('degraded').available).toBe(false);
    expect(remoteActionAvailability('degraded').reason).toMatch(/slowly|partially/);
  });
});

describe('draft remote mutations', () => {
  it('starts unreviewed and cannot be submitted', () => {
    const draft = createDraftRemoteMutation('d1', 'merge-pull-request', { number: 42 }, '2026-07-12T10:00:00Z');
    expect(draft.reviewed).toBe(false);
    expect(() => assertDraftReviewedBeforeSubmit(draft)).toThrow(DraftNotReviewedError);
  });

  it('can be submitted only after explicit review, and review is a distinct step per draft', () => {
    const draft = createDraftRemoteMutation('d1', 'publish-release', { tagName: 'v1.3.0' }, '2026-07-12T10:00:00Z');
    const reviewed = markDraftReviewed(draft);
    expect(reviewed.reviewed).toBe(true);
    expect(() => assertDraftReviewedBeforeSubmit(reviewed)).not.toThrow();
    // The original draft object is untouched — no shared mutable "reviewed" flag that could apply to a second draft.
    expect(draft.reviewed).toBe(false);
  });
});
