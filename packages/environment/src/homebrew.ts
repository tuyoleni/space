/**
 * Homebrew detection and install-step construction (spec section 8.4).
 * Homebrew itself is machine-scoped infrastructure, not a workspace
 * dependency (spec section 8.9) — Space only installs it when an essential
 * tool needs it and it's missing, and always shows the official source
 * first (spec 25.3.5: "HTTPS source verification").
 */
import type { InstallStrategy, PackageManagerScanResult, PlannedStep } from './types';

export const HOMEBREW_OFFICIAL_INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';
export const HOMEBREW_OFFICIAL_SITE_URL = 'https://brew.sh';

export const HOMEBREW_INSTALL_STRATEGY: InstallStrategy = {
  id: 'homebrew-official-installer',
  platform: 'darwin',
  kind: 'official-installer',
  executable: 'homebrew-install-sh',
  args: [],
  // Homebrew's own installer may `sudo` for /opt/homebrew or /usr/local
  // ownership; Space runs the specific installer process only, never the
  // whole app elevated (spec 8.4/8.6, ADR-004).
  requiresElevation: true,
  interactive: true,
  sourceDescription: `Homebrew official installer (${HOMEBREW_OFFICIAL_SITE_URL})`,
  officialSourceUrl: HOMEBREW_OFFICIAL_INSTALL_SCRIPT_URL,
};

/**
 * Builds the plan step that installs Homebrew, showing the official
 * installer source and the exact machine changes it will make (spec 8.4:
 * "Install Homebrew only after showing the official installer source and
 * required changes"). Space MUST NOT hide the password prompt Homebrew's
 * installer may show — `interactive: true` signals the executor to run
 * this attached to a real, visible terminal rather than a captured
 * subprocess.
 */
export function buildHomebrewInstallStep(sequence: number, architecture: string): PlannedStep {
  const targetPrefix = architecture === 'arm64' ? '/opt/homebrew' : '/usr/local';
  return {
    id: 'homebrew-install',
    sequence,
    toolId: null,
    kind: 'package-manager-install',
    displayName: 'Homebrew',
    humanExplanation:
      `Install Homebrew from the official installer (${HOMEBREW_OFFICIAL_SITE_URL}). ` +
      `This will create/use ${targetPrefix} and may prompt for your password — ` +
      'Space will show that prompt as-is, it is never hidden or simulated.',
    strategy: HOMEBREW_INSTALL_STRATEGY,
    requiresElevation: true,
    interactive: true,
    changesMachineState: true,
    deferredImplementation: false,
  };
}

/** True when any Homebrew-based install strategy would be used by the given tool strategies. */
export function needsHomebrew(chosenStrategies: readonly (InstallStrategy | null)[]): boolean {
  return chosenStrategies.some((strategy) => strategy?.packageManagerId === 'homebrew');
}

export function describeHomebrewScan(scan: PackageManagerScanResult | null): string {
  if (scan?.found) {
    return `Homebrew ${scan.version ?? ''} detected at ${scan.path ?? 'unknown path'}.`.trim();
  }
  return 'Homebrew was not detected in the standard Apple Silicon (/opt/homebrew) or Intel (/usr/local) prefixes, or on PATH.';
}
