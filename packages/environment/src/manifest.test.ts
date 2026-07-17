import { describe, expect, it } from 'vitest';
import { TOOL_MANIFEST, computeManifestFingerprint, verifyManifestFingerprint } from './manifest';

/**
 * Pinned fingerprint of TOOL_MANIFEST at the time this test was written.
 * Any edit to the manifest (spec 8.3: id/displayName/required/platforms/
 * detection/installStrategies/verify/minimumVersion/policy/uninstall
 * guidance for any tool) changes this value — deliberately update the
 * constant below when that happens, so drift is never silent.
 */
const PINNED_MANIFEST_FINGERPRINT = 'ec0c4086bf952a5bdda0655f49bbb97c1b265d3fa94c48f905804a050f4dddfd';

describe('TOOL_MANIFEST (spec section 8.3, ONB-003)', () => {
  it('declares exactly the default essential set (spec section 8.9)', () => {
    expect(TOOL_MANIFEST.entries.map((entry) => entry.id)).toEqual([
      'git',
      'gh',
      'volta',
      'node',
      'npm',
      'pnpm',
      'bun',
      'python',
    ]);
  });

  it('every entry supports both target platforms and has its required fields present', () => {
    for (const entry of TOOL_MANIFEST.entries) {
      expect(entry.supportedPlatforms).toEqual(['darwin', 'win32']);
      expect(entry.detection.length).toBeGreaterThan(0);
      expect(entry.verify.length).toBeGreaterThan(0);
      expect(['latest-supported', 'lts', 'pinned']).toContain(entry.recommendedVersionPolicy);
    }
  });

  it('git, gh, volta, node, and npm are the required essential tools; pnpm/Bun/Python are optional', () => {
    const requiredIds = TOOL_MANIFEST.entries.filter((entry) => entry.required).map((entry) => entry.id);
    const optionalIds = TOOL_MANIFEST.entries.filter((entry) => !entry.required).map((entry) => entry.id);
    expect(requiredIds).toEqual(['git', 'gh', 'volta', 'node', 'npm']);
    expect(optionalIds).toEqual(['pnpm', 'bun', 'python']);
  });

  it('every install strategy declares its official source, never a bare shell pipe', () => {
    for (const entry of TOOL_MANIFEST.entries) {
      for (const strategy of entry.installStrategies) {
        expect(strategy.officialSourceUrl.startsWith('https://')).toBe(true);
        expect(strategy.sourceDescription.length).toBeGreaterThan(0);
      }
    }
  });

  it('npm has no independent install strategy (bundled with Node via Volta)', () => {
    const npm = TOOL_MANIFEST.entries.find((entry) => entry.id === 'npm');
    expect(npm?.installStrategies).toEqual([]);
  });

  it('git and gh offer a Homebrew strategy on darwin and a WinGet strategy on win32', () => {
    for (const id of ['git', 'gh']) {
      const entry = TOOL_MANIFEST.entries.find((e) => e.id === id)!;
      expect(entry.installStrategies.some((s) => s.platform === 'darwin' && s.packageManagerId === 'homebrew')).toBe(true);
      expect(entry.installStrategies.some((s) => s.platform === 'win32' && s.packageManagerId === 'winget')).toBe(true);
    }
  });

  it('node is installed exclusively through Volta on both platforms (spec section 16.3)', () => {
    const node = TOOL_MANIFEST.entries.find((entry) => entry.id === 'node')!;
    expect(node.installStrategies.every((strategy) => strategy.kind === 'volta-managed')).toBe(true);
  });

  it('has a stable content fingerprint that changes if the manifest changes (integrity check, spec 8.3)', () => {
    expect(computeManifestFingerprint(TOOL_MANIFEST)).toBe(PINNED_MANIFEST_FINGERPRINT);
    expect(verifyManifestFingerprint(TOOL_MANIFEST, PINNED_MANIFEST_FINGERPRINT)).toBe(true);
  });

  it('fingerprint changes when a manifest field changes, proving it is a real integrity check', () => {
    const mutated = { ...TOOL_MANIFEST, manifestVersion: '1.0.1' };
    expect(computeManifestFingerprint(mutated)).not.toBe(PINNED_MANIFEST_FINGERPRINT);
    expect(verifyManifestFingerprint(mutated, PINNED_MANIFEST_FINGERPRINT)).toBe(false);
  });
});
