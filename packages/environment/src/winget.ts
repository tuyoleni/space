/**
 * WinGet (App Installer) detection and remediation messaging (spec section
 * 8.5). Unverified by execution — no Windows machine is available in this
 * environment; the logic follows the spec's exact requirements and is
 * unit-tested with fakes, but has not been run against real WinGet.
 */
import type { PackageManagerScanResult } from './types';

/** Windows 10 1809 (build 17763) is the minimum build with reliable WinGet/App Installer support. */
export const MINIMUM_WINGET_CAPABLE_BUILD = 17763;

export const WINGET_MICROSOFT_STORE_URL = 'https://apps.microsoft.com/detail/9nblggh4nns1';
export const WINGET_DOCS_URL = 'https://learn.microsoft.com/windows/package-manager/winget/';

/**
 * Parses `os.release()` on Windows (e.g. "10.0.22631") and returns the
 * build number, or null if it doesn't look like a Windows release string.
 */
export function parseWindowsBuildNumber(release: string): number | null {
  const match = /^10\.0\.(\d+)/.exec(release.trim());
  return match?.[1] ? Number(match[1]) : null;
}

export function isWindowsBuildWinGetCapable(release: string): boolean {
  const build = parseWindowsBuildNumber(release);
  return build !== null && build >= MINIMUM_WINGET_CAPABLE_BUILD;
}

/**
 * Explains remediation when WinGet is unavailable (spec 8.5: "Explain
 * remediation when WinGet is unavailable"). Distinguishes an unsupported
 * Windows build (no remediation available through App Installer) from a
 * supported build that's simply missing App Installer (fixable via the
 * Microsoft Store).
 */
export function describeWinGetRemediation(osRelease: string, scan: PackageManagerScanResult | null): string {
  if (scan?.found) {
    return `WinGet ${scan.version ?? ''} detected at ${scan.path ?? 'unknown path'}.`.trim();
  }
  if (!isWindowsBuildWinGetCapable(osRelease)) {
    return (
      `This Windows build (${osRelease}) is older than the minimum WinGet-capable build ` +
      `(10.0.${MINIMUM_WINGET_CAPABLE_BUILD}). Update Windows through Settings > Update, then re-run setup. ` +
      `See ${WINGET_DOCS_URL}.`
    );
  }
  return (
    'WinGet (App Installer) was not found. Install "App Installer" from the Microsoft Store ' +
    `(${WINGET_MICROSOFT_STORE_URL}), then re-run setup. Space will fall back to official signed ` +
    'installers for Git, GitHub CLI, and Volta if WinGet remains unavailable.'
  );
}
