import { describe, expect, it } from 'vitest';
import { LaneLayout } from './lanes';
import type { CommitNode } from './types';

/** Minimal commit factory for fixtures (display topological order: newest first). */
function commit(sha: string, parents: string[]): CommitNode {
  return {
    sha,
    parents,
    subject: sha,
    authorName: 'Fixture',
    authoredAt: 0,
    committedAt: 0,
    refs: [],
  };
}

describe('LaneLayout fixtures (spec section 12.4)', () => {
  it('linear history stays on one lane', () => {
    const rows = new LaneLayout().layout([
      commit('c3', ['c2']),
      commit('c2', ['c1']),
      commit('c1', []),
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[2]?.activeLaneCount).toBe(0);
  });

  it('simple branch diverges and converges', () => {
    const rows = new LaneLayout().layout([
      commit('merge', ['main2', 'feat1']),
      commit('feat1', ['main1']),
      commit('main2', ['main1']),
      commit('main1', []),
    ]);
    const bySha = Object.fromEntries(rows.map((r) => [r.sha, r]));
    expect(bySha.merge?.lane).toBe(0);
    expect(bySha.merge?.parentLanes).toEqual([0, 1]);
    expect(bySha.feat1?.lane).toBe(1);
    expect(bySha.main2?.lane).toBe(0);
    // Both edges converge on main1: it takes lane 0 and closes lane 1.
    expect(bySha.main1?.lane).toBe(0);
    expect(bySha.main1?.closedLanes).toEqual([1]);
  });

  it('octopus merge allocates a lane per extra parent', () => {
    const rows = new LaneLayout().layout([
      commit('octo', ['p1', 'p2', 'p3']),
      commit('p1', ['root']),
      commit('p2', ['root']),
      commit('p3', ['root']),
      commit('root', []),
    ]);
    const bySha = Object.fromEntries(rows.map((r) => [r.sha, r]));
    expect(bySha.octo?.parentLanes).toEqual([0, 1, 2]);
    expect(bySha.root?.lane).toBe(0);
    expect(bySha.root?.closedLanes).toEqual([1, 2]);
  });

  it('criss-cross merges keep both crossing edges representable', () => {
    const rows = new LaneLayout().layout([
      commit('mergeA', ['a1', 'b1']),
      commit('mergeB', ['b1', 'a1']),
      commit('b1', ['root']),
      commit('a1', ['root']),
      commit('root', []),
    ]);
    const bySha = Object.fromEntries(rows.map((r) => [r.sha, r]));
    // mergeB's second parent converges into the lane already flowing to a1.
    expect(bySha.mergeA?.parentLanes).toEqual([0, 1]);
    expect(bySha.mergeB?.parentLanes?.[1]).toBe(0);
    expect(bySha.root?.lane).toBe(0);
  });

  it('repeated merges reuse freed lanes deterministically', () => {
    const commits = [
      commit('m2', ['c2', 'f2']),
      commit('f2', ['c2']),
      commit('c2', ['m1']),
      commit('m1', ['c1', 'f1']),
      commit('f1', ['c1']),
      commit('c1', []),
    ];
    const first = new LaneLayout().layout(commits);
    const second = new LaneLayout().layout(commits);
    expect(first).toEqual(second);
    // Both feature branches occupy the same reused lane.
    const bySha = Object.fromEntries(first.map((r) => [r.sha, r]));
    expect(bySha.f1?.lane).toBe(bySha.f2?.lane);
  });

  it('pagination: batched layout equals single-shot layout row-for-row', () => {
    const commits = [
      commit('m2', ['c3', 'f2']),
      commit('f2', ['f1']),
      commit('c3', ['m1']),
      commit('m1', ['c2', 'f1']),
      commit('f1', ['c1']),
      commit('c2', ['c1']),
      commit('c1', []),
    ];
    const single = new LaneLayout().layout(commits);
    const paged = new LaneLayout();
    const rows = [
      ...paged.layout(commits.slice(0, 3)),
      ...paged.layout(commits.slice(3, 5)),
      ...paged.layout(commits.slice(5)),
    ];
    expect(rows).toEqual(single);
  });
});
