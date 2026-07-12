import { describe, expect, it } from 'vitest';
import { buildMacOsBootstrapPlan, checkAppleCommandLineTools } from './macos-plan';
import { TOOL_MANIFEST } from './manifest';
import type { ScanResult } from './types';

function baseScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedAt: '2026-07-12T00:00:00.000Z',
    platform: 'darwin',
    architecture: 'arm64',
    osVersion: '14.5.0',
    diskFreeBytes: 100_000_000_000,
    shellAvailable: true,
    shellPath: '/bin/zsh',
    packageManager: { id: 'homebrew', found: true, path: '/opt/homebrew/bin/brew', version: '4.3.1' },
    tools: [
      { toolId: 'git', found: true, path: '/usr/bin/git', version: '2.45.0', meetsMinimumVersion: true },
      { toolId: 'gh', found: true, path: '/opt/homebrew/bin/gh', version: '2.50.0', meetsMinimumVersion: true },
      { toolId: 'volta', found: true, path: '/Users/tester/.volta/bin/volta', version: '2.0.1', meetsMinimumVersion: true },
      { toolId: 'node', found: true, path: '/Users/tester/.volta/bin/node', version: '20.14.0', meetsMinimumVersion: true },
      { toolId: 'npm', found: true, path: '/Users/tester/.volta/bin/npm', version: '10.7.0', meetsMinimumVersion: true },
    ],
    editors: [],
    spaceShellIntegrationDetected: true,
    defaultProjectLocation: '/Users/tester/Space',
    canWriteDefaultProjectLocation: true,
    ...overrides,
  };
}

describe('buildMacOsBootstrapPlan (spec section 8.4, ONB-004)', () => {
  it('blocks when the macOS version is below the supported minimum', async () => {
    const plan = await buildMacOsBootstrapPlan(baseScan({ osVersion: '12.6.0' }), TOOL_MANIFEST, {
      appleCommandLineToolsInstalled: true,
    });
    expect(plan.blocked).toBe(true);
    expect(plan.blockReason).toContain('below the supported minimum');
    expect(plan.steps).toEqual([]);
  });

  it('produces only prerequisite checks when everything is already present', async () => {
    const plan = await buildMacOsBootstrapPlan(baseScan(), TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    expect(plan.blocked).toBe(false);
    expect(plan.steps.map((s) => s.kind)).toEqual(['prerequisite-check']);
  });

  it('plans a Homebrew install step first when git is missing and Homebrew is absent', async () => {
    const scan = baseScan({
      packageManager: { id: 'homebrew', found: false, path: null, version: null },
      tools: [
        { toolId: 'git', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'gh', found: true, path: '/x/gh', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: true, path: '/x/volta', version: '2.0.1', meetsMinimumVersion: true },
        { toolId: 'node', found: true, path: '/x/node', version: '20.14.0', meetsMinimumVersion: true },
        { toolId: 'npm', found: true, path: '/x/npm', version: '10.7.0', meetsMinimumVersion: true },
      ],
    });
    const plan = await buildMacOsBootstrapPlan(scan, TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    const kinds = plan.steps.map((s) => s.id);
    expect(kinds).toEqual(['check-apple-command-line-tools', 'homebrew-install', 'install-git']);
    expect(plan.steps.find((s) => s.id === 'install-git')?.strategy?.packageManagerId).toBe('homebrew');
  });

  it('does not plan a Homebrew install when Homebrew is already present', async () => {
    const scan = baseScan({
      tools: [
        { toolId: 'git', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'gh', found: true, path: '/x/gh', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: true, path: '/x/volta', version: '2.0.1', meetsMinimumVersion: true },
        { toolId: 'node', found: true, path: '/x/node', version: '20.14.0', meetsMinimumVersion: true },
        { toolId: 'npm', found: true, path: '/x/npm', version: '10.7.0', meetsMinimumVersion: true },
      ],
    });
    const plan = await buildMacOsBootstrapPlan(scan, TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    expect(plan.steps.some((s) => s.id === 'homebrew-install')).toBe(false);
  });

  it('plans Volta first and Node via Volta when both are missing, and skips npm as its own step', async () => {
    const scan = baseScan({
      tools: [
        { toolId: 'git', found: true, path: '/x/git', version: '2.45.0', meetsMinimumVersion: true },
        { toolId: 'gh', found: true, path: '/x/gh', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'node', found: false, path: null, version: null, meetsMinimumVersion: null },
        { toolId: 'npm', found: false, path: null, version: null, meetsMinimumVersion: null },
      ],
    });
    const plan = await buildMacOsBootstrapPlan(scan, TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    const ids = plan.steps.map((s) => s.id);
    expect(ids.indexOf('install-volta')).toBeLessThan(ids.indexOf('install-node'));
    expect(ids).toContain('verify-npm');
    expect(plan.steps.find((s) => s.id === 'install-node')?.strategy?.kind).toBe('volta-managed');
  });

  it('flags a below-minimum-version tool as needing (re)install', async () => {
    const scan = baseScan({
      tools: [
        { toolId: 'git', found: true, path: '/x/git', version: '2.10.0', meetsMinimumVersion: false },
        { toolId: 'gh', found: true, path: '/x/gh', version: '2.50.0', meetsMinimumVersion: true },
        { toolId: 'volta', found: true, path: '/x/volta', version: '2.0.1', meetsMinimumVersion: true },
        { toolId: 'node', found: true, path: '/x/node', version: '20.14.0', meetsMinimumVersion: true },
        { toolId: 'npm', found: true, path: '/x/npm', version: '10.7.0', meetsMinimumVersion: true },
      ],
    });
    const plan = await buildMacOsBootstrapPlan(scan, TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    expect(plan.steps.some((s) => s.id === 'install-git')).toBe(true);
  });

  it('adds a deferred shell-integration step when Space integration is not detected', async () => {
    const plan = await buildMacOsBootstrapPlan(baseScan({ spaceShellIntegrationDetected: false }), TOOL_MANIFEST, {
      appleCommandLineToolsInstalled: true,
    });
    const step = plan.steps.find((s) => s.kind === 'shell-integration');
    expect(step?.deferredImplementation).toBe(true);
  });

  it('never installs optional tools like pnpm/Docker (spec section 39, 8.9)', async () => {
    const plan = await buildMacOsBootstrapPlan(baseScan(), TOOL_MANIFEST, { appleCommandLineToolsInstalled: true });
    expect(plan.steps.some((s) => /pnpm|docker|python|yarn/i.test(s.displayName))).toBe(false);
  });
});

describe('checkAppleCommandLineTools', () => {
  it('is true when xcode-select resolves', async () => {
    expect(await checkAppleCommandLineTools(async () => '/usr/bin/xcode-select')).toBe(true);
  });

  it('is false when xcode-select is not found', async () => {
    expect(await checkAppleCommandLineTools(async () => null)).toBe(false);
  });
});
