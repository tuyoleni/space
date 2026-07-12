import { describe, expect, it } from 'vitest';
import { describeWinGetRemediation, isWindowsBuildWinGetCapable, parseWindowsBuildNumber } from './winget';

describe('parseWindowsBuildNumber', () => {
  it('extracts the build number from a Windows release string', () => {
    expect(parseWindowsBuildNumber('10.0.22631')).toBe(22631);
  });

  it('returns null for a non-Windows-shaped release string', () => {
    expect(parseWindowsBuildNumber('14.5.0')).toBeNull();
    expect(parseWindowsBuildNumber('garbage')).toBeNull();
  });
});

describe('isWindowsBuildWinGetCapable', () => {
  it('is true for builds at or above 17763', () => {
    expect(isWindowsBuildWinGetCapable('10.0.17763')).toBe(true);
    expect(isWindowsBuildWinGetCapable('10.0.22631')).toBe(true);
  });

  it('is false for older builds', () => {
    expect(isWindowsBuildWinGetCapable('10.0.16299')).toBe(false);
  });
});

describe('describeWinGetRemediation (spec section 8.5)', () => {
  it('reports the detected version when WinGet is found', () => {
    const message = describeWinGetRemediation('10.0.22631', {
      id: 'winget',
      found: true,
      path: 'C:\\WinGet\\winget.exe',
      version: 'v1.8.1911',
    });
    expect(message).toContain('v1.8.1911');
  });

  it('recommends a Windows update when the build predates WinGet support', () => {
    const message = describeWinGetRemediation('10.0.16299', { id: 'winget', found: false, path: null, version: null });
    expect(message).toContain('Update Windows');
  });

  it('recommends installing App Installer from the Microsoft Store on a capable but missing build', () => {
    const message = describeWinGetRemediation('10.0.22631', { id: 'winget', found: false, path: null, version: null });
    expect(message).toContain('Microsoft Store');
    expect(message).toContain('official signed');
  });
});
