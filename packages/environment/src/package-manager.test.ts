import { describe, expect, it } from 'vitest';
import { detectPackageManager, installCommandFor } from './package-manager';
import type { ProjectDetectionFsPort } from './project-detection';

function fakeFs(entries: readonly string[]): ProjectDetectionFsPort {
  return {
    listDirectory: async () => entries,
    readTextFile: async () => null,
  };
}

describe('detectPackageManager', () => {
  it('resolves npm from package-lock.json', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['package.json', 'package-lock.json']));
    expect(result.resolution).toBe('single');
    expect(result.packageManager).toBe('npm');
  });

  it('resolves yarn from yarn.lock', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['yarn.lock']));
    expect(result.packageManager).toBe('yarn');
  });

  it('resolves pnpm from pnpm-lock.yaml', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['pnpm-lock.yaml']));
    expect(result.packageManager).toBe('pnpm');
  });

  it('reports "none" when no lockfile is present, without guessing', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['package.json']));
    expect(result.resolution).toBe('none');
    expect(result.packageManager).toBeNull();
  });

  it('reports "conflict" and refuses to pick when incompatible lockfiles coexist', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['yarn.lock', 'package-lock.json']));
    expect(result.resolution).toBe('conflict');
    expect(result.packageManager).toBeNull();
    expect(result.lockfilesFound).toHaveLength(2);
  });

  it('does not treat two npm-flavoured lockfiles as a conflict', async () => {
    const result = await detectPackageManager('/proj', fakeFs(['package-lock.json', 'npm-shrinkwrap.json']));
    expect(result.resolution).toBe('single');
    expect(result.packageManager).toBe('npm');
  });
});

describe('installCommandFor', () => {
  it('never regenerates or force-converts a lockfile', () => {
    expect(installCommandFor('npm')).toEqual({ executable: 'npm', args: ['install'] });
    expect(installCommandFor('yarn')).toEqual({ executable: 'yarn', args: ['install'] });
    expect(installCommandFor('pnpm')).toEqual({ executable: 'pnpm', args: ['install'] });
  });
});
