/**
 * Lane layout algorithm (spec section 12.4). Processes commits in the
 * displayed topological order and assigns each row a lane such that:
 *   - active lanes are stable,
 *   - the first parent stays on the current lane where possible,
 *   - additional parents are allocated their own lanes,
 *   - divergence and convergence are representable from the row data,
 *   - output is deterministic for the same commit sequence, and
 *   - lane assignments never change when another page loads (the layout
 *     is a pure function of the commit prefix).
 */
import type { CommitNode } from './types';

export interface LaneRow {
  readonly sha: string;
  /** Lane occupied by this commit's node. */
  readonly lane: number;
  /** Lane each parent edge continues or begins on (parallel to parents). */
  readonly parentLanes: readonly number[];
  /** Lanes freed at this row because sibling edges converged here. */
  readonly closedLanes: readonly number[];
  /** Number of lanes in use after this row (drives row width). */
  readonly activeLaneCount: number;
}

export class LaneLayout {
  /** Each active lane holds the sha it is waiting to reach, or null if free. */
  private lanes: (string | null)[] = [];

  /**
   * Consume the next page of commits (in display topological order) and
   * return their rows. Internal state carries across calls, so feeding one
   * batch or the same commits split across batches yields identical rows.
   */
  layout(commits: readonly CommitNode[]): LaneRow[] {
    const rows: LaneRow[] = [];
    for (const commit of commits) {
      rows.push(this.place(commit));
    }
    return rows;
  }

  private place(commit: CommitNode): LaneRow {
    const waiting: number[] = [];
    for (let i = 0; i < this.lanes.length; i += 1) {
      if (this.lanes[i] === commit.sha) {
        waiting.push(i);
      }
    }

    const lane = waiting.length > 0 ? (waiting[0] as number) : this.allocateLane();
    const closedLanes = waiting.slice(1);
    for (const closed of closedLanes) {
      this.lanes[closed] = null;
    }

    const parentLanes: number[] = [];
    const firstParent = commit.parents[0];
    if (firstParent === undefined) {
      this.lanes[lane] = null;
    } else {
      // First parent continues on the commit's own lane.
      this.lanes[lane] = firstParent;
      parentLanes.push(lane);
      for (const parent of commit.parents.slice(1)) {
        const existing = this.lanes.indexOf(parent);
        if (existing !== -1) {
          // A lane is already flowing toward this parent; the merge edge
          // converges into it rather than opening a new lane.
          parentLanes.push(existing);
        } else {
          const allocated = this.allocateLane();
          this.lanes[allocated] = parent;
          parentLanes.push(allocated);
        }
      }
    }

    this.trimTrailingFreeLanes();
    return {
      sha: commit.sha,
      lane,
      parentLanes,
      closedLanes,
      activeLaneCount: this.lanes.length,
    };
  }

  private allocateLane(): number {
    const free = this.lanes.indexOf(null);
    if (free !== -1) {
      return free;
    }
    this.lanes.push(null);
    return this.lanes.length - 1;
  }

  private trimTrailingFreeLanes(): void {
    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) {
      this.lanes.pop();
    }
  }
}
