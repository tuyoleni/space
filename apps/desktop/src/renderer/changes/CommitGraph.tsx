import { useMemo } from 'react';
import type { GitCommitNode, GitCommitRef } from '@space/contracts';
import { Badge, formatRelativeTime } from '@space/ui';

/**
 * A real commit graph — a coloured lane gutter (dots, branch splits, merge
 * curves) drawn in SVG beside styled HTML commit rows (avatar, ref badges,
 * subject, author · relative time · short sha). This replaces the third-party
 * @gitgraph canvas so the history reads like the rest of the app and like a
 * git client's graph, not a plain list. Lanes are assigned from the real
 * parent DAG of the loaded `GitCommitNode[]` page (newest → oldest, top-down).
 */

const LANE_WIDTH = 22;
const ROW_HEIGHT = 46;
const DOT_RADIUS = 5;
const LANE_STROKE = 2.75;
const MID = ROW_HEIGHT / 2;
// Same palette as the former graph so colours stay familiar across the app.
const LANE_COLORS = ['#3b82f6', '#39d353', '#e3a008', '#f04747', '#a855f7', '#14b8a6'] as const;

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length]!;
}

interface LaneEdge {
  readonly from: number;
  readonly to: number;
  readonly color: string;
}

interface CommitRow {
  readonly commit: GitCommitNode;
  readonly col: number;
  readonly color: string;
  /** Segments from the top edge (y=0) down to the row centre. */
  readonly topEdges: readonly LaneEdge[];
  /** Segments from the row centre down to the bottom edge (y=ROW_HEIGHT). */
  readonly bottomEdges: readonly LaneEdge[];
}

interface GraphLayout {
  readonly rows: readonly CommitRow[];
  readonly columns: number;
}

function firstFree(lanes: readonly (string | undefined)[]): number {
  const index = lanes.indexOf(undefined);
  return index === -1 ? lanes.length : index;
}

/**
 * Walk the page top-down assigning each commit a column. Pass-through lanes
 * keep their column (so their lines stay vertical); a commit's first parent
 * inherits the commit's column, extra parents (merges) open new lanes, and a
 * parent that already has an active lane is merged into it rather than duplicated.
 */
function layoutCommits(commits: readonly GitCommitNode[]): GraphLayout {
  const rows: CommitRow[] = [];
  let lanes: (string | undefined)[] = [];
  let maxColumns = 0;

  for (const commit of commits) {
    const input = lanes.slice();
    const ownLane = input.indexOf(commit.sha);
    const col = ownLane === -1 ? firstFree(input) : ownLane;

    // Consume every lane waiting on this commit (children converging in).
    const output = input.slice();
    for (let i = 0; i < output.length; i += 1) {
      if (output[i] === commit.sha) {
        output[i] = undefined;
      }
    }

    const parentCols: number[] = [];
    commit.parents.forEach((parent, parentIndex) => {
      const existing = output.indexOf(parent);
      if (existing !== -1) {
        parentCols[parentIndex] = existing;
        return;
      }
      const target = parentIndex === 0 ? col : firstFree(output);
      output[target] = parent;
      parentCols[parentIndex] = target;
    });

    while (output.length > 0 && output[output.length - 1] === undefined) {
      output.pop();
    }

    const topEdges: LaneEdge[] = [];
    for (let i = 0; i < input.length; i += 1) {
      const sha = input[i];
      if (sha === undefined) continue;
      topEdges.push(sha === commit.sha ? { from: i, to: col, color: laneColor(i) } : { from: i, to: i, color: laneColor(i) });
    }

    const bottomEdges: LaneEdge[] = [];
    for (let i = 0; i < input.length; i += 1) {
      if (input[i] !== undefined && input[i] !== commit.sha && output[i] === input[i]) {
        bottomEdges.push({ from: i, to: i, color: laneColor(i) });
      }
    }
    for (const parentCol of parentCols) {
      bottomEdges.push({ from: col, to: parentCol, color: laneColor(parentCol) });
    }

    rows.push({ commit, col, color: laneColor(col), topEdges, bottomEdges });
    lanes = output;
    maxColumns = Math.max(maxColumns, input.length, output.length, col + 1);
  }

  return { rows, columns: Math.max(1, maxColumns) };
}

function laneX(col: number): number {
  return LANE_WIDTH / 2 + col * LANE_WIDTH;
}

/** A vertical-ish connector: straight when the column is unchanged, a smooth S-curve when it shifts lanes. */
function edgePath(from: number, to: number, y1: number, y2: number): string {
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function refBadge(ref: GitCommitRef, key: string): JSX.Element {
  if (ref.kind === 'HEAD') {
    return (
      <Badge key={key} variant="accent">
        HEAD
      </Badge>
    );
  }
  if (ref.kind === 'tag') {
    return (
      <Badge key={key} variant="warning">
        {ref.name}
      </Badge>
    );
  }
  // Remote branches read one notch quieter than local ones.
  return (
    <Badge key={key} variant={ref.kind === 'remote-branch' ? 'neutral' : 'success'}>
      {ref.name}
    </Badge>
  );
}

interface CommitGraphProps {
  readonly commits: readonly GitCommitNode[];
}

export function CommitGraph({ commits }: CommitGraphProps) {
  const layout = useMemo(() => layoutCommits(commits), [commits]);

  if (commits.length === 0) {
    return <p className="text-sm text-fg-faint">No commits yet.</p>;
  }

  const gutterWidth = layout.columns * LANE_WIDTH;

  return (
    <div className="overflow-x-auto">
      <ul className="min-w-full">
        {layout.rows.map((row) => {
          const when = formatRelativeTime(new Date(row.commit.committedAt).toISOString());
          const shortSha = row.commit.sha.slice(0, 7);
          const isMerge = row.commit.parents.length > 1;
          return (
            <li key={row.commit.sha} className="flex items-stretch gap-3 rounded-md pr-2 hover:bg-surface-hover">
              <svg width={gutterWidth} height={ROW_HEIGHT} className="shrink-0" aria-hidden>
                {row.topEdges.map((edge, index) => (
                  <path
                    key={`t${index}`}
                    d={edgePath(edge.from, edge.to, 0, MID)}
                    stroke={edge.color}
                    strokeWidth={LANE_STROKE}
                    fill="none"
                  />
                ))}
                {row.bottomEdges.map((edge, index) => (
                  <path
                    key={`b${index}`}
                    d={edgePath(edge.from, edge.to, MID, ROW_HEIGHT)}
                    stroke={edge.color}
                    strokeWidth={LANE_STROKE}
                    fill="none"
                  />
                ))}
                {/* Separation halo so the node reads clear of the lanes it sits on. */}
                <circle cx={laneX(row.col)} cy={MID} r={DOT_RADIUS + 2} className="fill-app-bg" />
                <circle cx={laneX(row.col)} cy={MID} r={DOT_RADIUS} fill={row.color} />
                {/* A hollow centre marks a merge node. */}
                {isMerge && <circle cx={laneX(row.col)} cy={MID} r={2} className="fill-app-bg" />}
              </svg>

              <div className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
                <div className="flex items-center gap-1.5">
                  {row.commit.refs.map((ref, index) => refBadge(ref, `${row.commit.sha}-${index}`))}
                  <span className="truncate text-sm text-fg">{row.commit.subject}</span>
                </div>
                <div className="truncate text-[11px] text-fg-faint">
                  {row.commit.authorName} · <time title={when.exact}>{when.relative}</time> ·{' '}
                  <span className="font-mono">{shortSha}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
