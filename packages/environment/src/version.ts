/**
 * Minimal semantic-version comparison. Deliberately not a full semver
 * implementation (no pre-release/build metadata precedence rules) — spec
 * section 16.2 requires "semantic version ranges and capability checks,
 * not only equality" for detection, which this satisfies for the plain
 * MAJOR.MINOR.PATCH versions Git/GitHub CLI/Volta/Node/npm report.
 */
export function parseVersion(input: string): readonly [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(input.trim());
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor ?? '0'), Number(patch ?? '0')];
}

/** Returns -1, 0, or 1 like Array.prototype.sort comparators. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    throw new Error(`Cannot compare unparseable versions: "${a}" vs "${b}"`);
  }
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

/** True when `version` is present, parseable, and >= `minimum`. Returns null if either is unparseable. */
export function meetsMinimumVersion(version: string | null, minimum: string | undefined): boolean | null {
  if (minimum === undefined) {
    return null;
  }
  if (version === null || parseVersion(version) === null || parseVersion(minimum) === null) {
    return null;
  }
  return compareVersions(version, minimum) >= 0;
}

/** Extracts the first capture group from `pattern` in `text`, or null. */
export function extractVersion(text: string, pattern: string): string | null {
  const match = new RegExp(pattern).exec(text);
  return match?.[1] ?? null;
}
