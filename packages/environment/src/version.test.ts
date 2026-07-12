import { describe, expect, it } from 'vitest';
import { compareVersions, extractVersion, meetsMinimumVersion, parseVersion } from './version';

describe('parseVersion', () => {
  it('parses MAJOR.MINOR.PATCH', () => {
    expect(parseVersion('2.43.0')).toEqual([2, 43, 0]);
  });

  it('defaults a missing patch to 0', () => {
    expect(parseVersion('1.1')).toEqual([1, 1, 0]);
  });

  it('tolerates a leading v and trailing text', () => {
    expect(parseVersion('v18.18.2 (some build)')).toEqual([18, 18, 2]);
  });

  it('returns null for unparseable input', () => {
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('throws for unparseable input rather than silently comparing garbage', () => {
    expect(() => compareVersions('nope', '1.0.0')).toThrow();
  });
});

describe('meetsMinimumVersion', () => {
  it('returns true when version >= minimum', () => {
    expect(meetsMinimumVersion('2.45.0', '2.30.0')).toBe(true);
  });

  it('returns false when version < minimum', () => {
    expect(meetsMinimumVersion('2.20.0', '2.30.0')).toBe(false);
  });

  it('returns null when there is no minimum to check against', () => {
    expect(meetsMinimumVersion('2.45.0', undefined)).toBeNull();
  });

  it('returns null when the version is absent or unparseable rather than throwing', () => {
    expect(meetsMinimumVersion(null, '2.30.0')).toBeNull();
    expect(meetsMinimumVersion('not-a-version', '2.30.0')).toBeNull();
  });
});

describe('extractVersion', () => {
  it('extracts the first capture group', () => {
    expect(extractVersion('git version 2.43.0', 'git version (\\d+\\.\\d+(?:\\.\\d+)?)')).toBe('2.43.0');
  });

  it('returns null when the pattern does not match', () => {
    expect(extractVersion('command not found', 'git version (\\d+\\.\\d+)')).toBeNull();
  });
});
