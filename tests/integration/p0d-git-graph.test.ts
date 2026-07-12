/**
 * P0-D technical spike (spec section 36.1.4): prove parser, pagination,
 * and the stable lane algorithm against a large generated repository
 * (100,000 commits with recurring branch/merge structure, spec 12.5).
 *
 * The repository is generated with `git fast-import`; history is read with
 * the real `git log` invocation the product will use. Rendering
 * virtualisation is a renderer concern proven in M5 - this spike proves
 * the data pipeline stays fast and deterministic at scale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LaneLayout, historyLogArgs, parseHistoryOutput } from '@space/git-engine';

const TOTAL_COMMITS = 100_000;
const MERGE_EVERY = 500;
const SIDE_CHAIN_LENGTH = 3;

let repoDir: string;
let logOutput: string;

function buildFastImportStream(): string {
  const chunks: string[] = [];
  const identity = 'Fixture Author <fixture@space.test>';
  let mark = 0;
  let lastMainline = 0;
  const message = 'fixture commit';

  const emit = (parents: number[]): number => {
    mark += 1;
    const timestamp = 1_600_000_000 + mark;
    chunks.push(`commit refs/heads/main\nmark :${mark}\n`);
    chunks.push(`committer ${identity} ${timestamp} +0000\n`);
    chunks.push(`data ${message.length}\n${message}\n`);
    if (parents.length > 0) {
      chunks.push(`from :${parents[0]}\n`);
      for (const parent of parents.slice(1)) {
        chunks.push(`merge :${parent}\n`);
      }
    }
    chunks.push('\n');
    return mark;
  };

  let produced = 0;
  while (produced < TOTAL_COMMITS) {
    if (lastMainline !== 0 && produced % MERGE_EVERY === 0 && produced + SIDE_CHAIN_LENGTH + 1 <= TOTAL_COMMITS) {
      // Branch a short side chain from the current mainline tip, then merge.
      let side = lastMainline;
      for (let i = 0; i < SIDE_CHAIN_LENGTH; i += 1) {
        side = emit([side]);
        produced += 1;
      }
      lastMainline = emit([lastMainline, side]);
      produced += 1;
    } else {
      lastMainline = emit(lastMainline === 0 ? [] : [lastMainline]);
      produced += 1;
    }
  }
  return chunks.join('');
}

beforeAll(async () => {
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-p0d-'));
  execFileSync('git', ['init', '-b', 'main', '--quiet'], { cwd: repoDir });
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repoDir,
    input: buildFastImportStream(),
    maxBuffer: 256 * 1024 * 1024,
  });
  logOutput = execFileSync('git', historyLogArgs(), {
    cwd: repoDir,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
}, 180_000);

afterAll(async () => {
  await fs.rm(repoDir, { recursive: true, force: true });
});

describe('P0-D: git graph at scale (spec section 36.1.4)', () => {
  it('parses all 100,000 commits from real git log output', () => {
    const started = performance.now();
    const commits = parseHistoryOutput(logOutput);
    const elapsedMs = performance.now() - started;

    expect(commits).toHaveLength(TOTAL_COMMITS);
    const merges = commits.filter((c) => c.parents.length > 1);
    expect(merges.length).toBeGreaterThan(100);
    // Parser budget: well under a second of CPU for 100k commits.
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it('lays out 100,000 rows deterministically within budget', () => {
    const commits = parseHistoryOutput(logOutput);

    const started = performance.now();
    const rows = new LaneLayout().layout(commits);
    const elapsedMs = performance.now() - started;

    expect(rows).toHaveLength(TOTAL_COMMITS);
    expect(elapsedMs).toBeLessThan(3_000);

    // Bounded lane width: short side chains must reuse lanes, not leak them.
    const maxLanes = Math.max(...rows.map((r) => r.activeLaneCount));
    expect(maxLanes).toBeLessThanOrEqual(4);

    // Deterministic output for the same commit sequence.
    const again = new LaneLayout().layout(commits);
    expect(again[0]).toEqual(rows[0]);
    expect(again[TOTAL_COMMITS - 1]).toEqual(rows[TOTAL_COMMITS - 1]);
    expect(again[12_345]).toEqual(rows[12_345]);
  });

  it('keeps lane assignments stable across paginated loads', () => {
    const commits = parseHistoryOutput(logOutput);
    const single = new LaneLayout().layout(commits);

    const paged = new LaneLayout();
    const pageSize = 10_000;
    const pagedRows = [];
    for (let offset = 0; offset < commits.length; offset += pageSize) {
      pagedRows.push(...paged.layout(commits.slice(offset, offset + pageSize)));
    }

    expect(pagedRows).toHaveLength(single.length);
    for (const index of [0, 9_999, 10_000, 55_555, TOTAL_COMMITS - 1]) {
      expect(pagedRows[index]).toEqual(single[index]);
    }
  });
});
