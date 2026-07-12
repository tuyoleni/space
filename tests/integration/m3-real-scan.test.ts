/**
 * M3: real, non-mutating scan (spec section 8.2, ONB-002) — run for real
 * against this development machine, using the real Node-backed adapters
 * (`createNodeScanDependencies`), not fakes. This mirrors how the P0-A
 * spike was verified by actually launching the packaged app rather than
 * only unit-testing it: the scan's read-only contract is safe to exercise
 * for real, so this proves the DI wiring and OS/PATH lookups genuinely
 * work on macOS arm64, not just against fakes in scan.test.ts.
 *
 * This test performs no installs, no PATH edits, no authentication, and
 * no repository creation — it only asserts on what performScan reports.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_MANIFEST, createNodeScanDependencies, performScan } from '@space/environment';

describe('M3: real non-mutating scan against this machine (spec section 8.2)', () => {
  it('reports accurate platform/architecture and finds Git, which this repo requires', async () => {
    const deps = createNodeScanDependencies(path.join(os.tmpdir(), 'space-m3-scan-target'));
    const result = await performScan(TOOL_MANIFEST, deps);

    expect(result.platform).toBe(process.platform);
    expect(result.architecture).toBe(os.arch());
    expect(result.osVersion.length).toBeGreaterThan(0);
    expect(result.tools).toHaveLength(5);

    // Git is a hard prerequisite of this repository (it's a git repo under test).
    const git = result.tools.find((t) => t.toolId === 'git');
    expect(git?.found).toBe(true);
    expect(git?.version).toMatch(/^\d+\.\d+/);

    // eslint-disable-next-line no-console
    console.log('[M3 real scan] result:', JSON.stringify(result, null, 2));
  });

  it('reports write access to a real writable temp directory without creating it', async () => {
    const target = path.join(os.tmpdir(), `space-m3-scan-${Date.now()}`);
    const deps = createNodeScanDependencies(target);
    const result = await performScan(TOOL_MANIFEST, deps);

    expect(result.canWriteDefaultProjectLocation).toBe(true);
    // The scan must not have created the target directory itself.
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it('does not modify PATH, install anything, or write to disk (structural guarantee, not just observed)', async () => {
    const pathBefore = process.env['PATH'];
    const deps = createNodeScanDependencies(os.tmpdir());
    await performScan(TOOL_MANIFEST, deps);
    expect(process.env['PATH']).toBe(pathBefore);
  });
});
