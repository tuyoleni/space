import { describe, expect, it } from 'vitest';
import { buildWindowsBootstrapPlan, isConPtyCapable } from './windows-plan';
import { TOOL_MANIFEST } from './manifest';
import type { ScanResult } from './types';

function baseScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedAt: '2026-07-12T00:00:00.000Z',
    platform: 'win32',
    architecture: 'x64',
    osVersion: '10.0.22631',
    diskFreeBytes: 100_000_000_000,
    shellAvailable: true,
    shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    packageManager: { id: 'winget', found: true, path: 'C:\\WinGet\\winget.exe', version: 'v1.8.1911' },
    tools: [
      { toolId: 'git', found: true, path: 'C:\\Git\\git.exe', version: '2.45.0', meetsMinimumVersion: true },
      { toolId: 'gh', found: true, path: 'C:\\gh\\gh.exe', version: '2.50.0', meetsMinimumVersion: true },
      { toolId: 'volta', found: true, path: 'C:\\Volta\\volta.exe', version: '2.0.1', meetsMinimumVersion: true },
      { toolId: 'node', found: true, path: 'C:\\Volta\\node.exe', version: '20.14.0', meetsMinimumVersion: true },
      { toolId: 'npm', found: true, path: 'C:\\Volta\\npm.cmd', version: '10.7.0', meetsMinimumVersion: true },
    ],
    editors: [],
    spaceShellIntegrationDetected: true,
    defaultProjectLocation: 'C:\\Users\\tester\\Space',
    canWriteDefaultProjectLocation: true,
    ...overrides,
  };
}

describe('buildWindowsBootstrapPlan (spec section 8.5, ONB-005)', () => {
  it('blocks when the Windows build predates WinGet/ConPTY support', async () => {
    const plan = await buildWindowsBootstrapPlan(baseScan({ osVersion: '10.0.16299' }), TOOL_MANIFEST);
    expect(plan.blocked).toBe(true);
    expect(plan.blockReason).toContain('below the supported minimum');
  });

  it('produces only prerequisite checks when everything is already present', async () => {
    const plan = await buildWindowsBootstrapPlan(baseScan(), TOOL_MANIFEST);
    expect(plan.steps.map((s) => s.kind)).toEqual(['prerequisite-check', 'prerequisite-check']);
  });

  it('chooses the WinGet strategy for a missing tool when WinGet is available', async () => {
    const scan = baseScan({
      tools: [
        { toolId: 'git', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'gh', found: true, path: 'C:\\gh\\gh.exe', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: true, path: 'C:\\Volta\\volta.exe', version: '2.0.1', meetsMinimumVersion: true },
        { toolId: 'node', found: true, path: 'C:\\Volta\\node.exe', version: '20.14.0', meetsMinimumVersion: true },
        { toolId: 'npm', found: true, path: 'C:\\Volta\\npm.cmd', version: '10.7.0', meetsMinimumVersion: true },
      ],
    });
    const plan = await buildWindowsBootstrapPlan(scan, TOOL_MANIFEST);
    const step = plan.steps.find((s) => s.id === 'install-git');
    expect(step?.strategy?.packageManagerId).toBe('winget');
  });

  it('falls back to the official installer when WinGet is unavailable', async () => {
    const scan = baseScan({
      packageManager: { id: 'winget', found: false, path: null, version: null },
      tools: [
        { toolId: 'git', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'gh', found: true, path: 'C:\\gh\\gh.exe', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: true, path: 'C:\\Volta\\volta.exe', version: '2.0.1', meetsMinimumVersion: true },
        { toolId: 'node', found: true, path: 'C:\\Volta\\node.exe', version: '20.14.0', meetsMinimumVersion: true },
        { toolId: 'npm', found: true, path: 'C:\\Volta\\npm.cmd', version: '10.7.0', meetsMinimumVersion: true },
      ],
    });
    const plan = await buildWindowsBootstrapPlan(scan, TOOL_MANIFEST);
    const step = plan.steps.find((s) => s.id === 'install-git');
    expect(step?.strategy?.kind).toBe('official-installer');
    expect(step?.strategy?.requiresElevation).toBe(true);
  });

  it('never requires whole-app elevation — only individual installer strategies request it (spec 8.5/8.6)', async () => {
    const plan = await buildWindowsBootstrapPlan(baseScan(), TOOL_MANIFEST);
    // The plan itself carries no elevation flag; only per-step strategies may.
    expect(plan).not.toHaveProperty('requiresElevation');
  });

  it('plans Node via Volta and skips npm as an independent step', async () => {
    const scan = baseScan({
      tools: [
        { toolId: 'git', found: true, path: 'C:\\Git\\git.exe', version: '2.45.0', meetsMinimumVersion: true },
        { toolId: 'gh', found: true, path: 'C:\\gh\\gh.exe', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'node', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'npm', found: false, path: null, version: null, meetsMinimumVersion: null },
      ],
    });
    const plan = await buildWindowsBootstrapPlan(scan, TOOL_MANIFEST);
    const ids = plan.steps.map((s) => s.id);
    expect(ids.indexOf('install-volta')).toBeLessThan(ids.indexOf('install-node'));
    expect(ids).toContain('verify-npm');
    expect(plan.steps.find((s) => s.id === 'install-node')?.strategy?.kind).toBe('volta-managed');
  });

  it('adds a deferred PowerShell shell-integration step when Space integration is not detected', async () => {
    const plan = await buildWindowsBootstrapPlan(baseScan({ spaceShellIntegrationDetected: false }), TOOL_MANIFEST);
    const step = plan.steps.find((s) => s.kind === 'shell-integration');
    expect(step?.deferredImplementation).toBe(true);
    expect(step?.displayName).toContain('PowerShell');
  });
});

describe('isConPtyCapable', () => {
  it('is true for a modern Windows build', () => {
    expect(isConPtyCapable('10.0.22631')).toBe(true);
  });

  it('is false for an old Windows build', () => {
    expect(isConPtyCapable('10.0.14393')).toBe(false);
  });
});
