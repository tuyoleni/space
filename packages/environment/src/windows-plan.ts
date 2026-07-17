/**
 * ONB-005: Windows bootstrap plan (spec section 8.5).
 *
 * Unverified by execution — no Windows machine is available in this
 * environment. The selection logic (WinGet-first, official-installer
 * fallback) and required behaviours (no whole-app elevation, ConPTY check,
 * PowerShell-first shell integration) follow the spec exactly and are
 * unit-tested with fakes, but have not been run against real WinGet.
 */
import { isWindowsBuildWinGetCapable } from './winget';
import { meetsMinimumVersion } from './version';
import type { BootstrapPlan, InstallStrategy, PlannedStep, ScanResult, ToolManifest, ToolManifestEntry } from './types';

function isSatisfied(entry: ToolManifestEntry, scan: ScanResult): boolean {
  const found = scan.tools.find((tool) => tool.toolId === entry.id);
  if (!found?.found) {
    return false;
  }
  return meetsMinimumVersion(found.version, entry.minimumVersion) !== false;
}

function chooseWinGetStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'win32' && s.kind === 'package-manager') ?? null;
}

function chooseVoltaManagedStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'win32' && s.kind === 'volta-managed') ?? null;
}

function chooseOfficialInstallerStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'win32' && s.kind === 'official-installer') ?? null;
}

/**
 * WinGet-first, official-signed-installer fallback (spec 8.5: "Install
 * Git for Windows, GitHub CLI, and Volta through WinGet or official signed
 * installers"). Both strategies request elevation only for the specific
 * installer process, never the whole app (spec 8.5/8.6, ADR-004).
 */
function selectWindowsStrategy(entry: ToolManifestEntry, winGetAvailable: boolean): InstallStrategy | null {
  if (winGetAvailable) {
    const winget = chooseWinGetStrategy(entry);
    if (winget) {
      return winget;
    }
  }
  return chooseOfficialInstallerStrategy(entry);
}

function buildToolStep(entry: ToolManifestEntry, sequence: number, strategy: InstallStrategy | null): PlannedStep {
  return {
    id: `install-${entry.id}`,
    sequence,
    toolId: entry.id,
    kind: 'tool-install',
    displayName: entry.displayName,
    humanExplanation: strategy
      ? `Install ${entry.displayName} via ${strategy.sourceDescription}.`
      : `${entry.displayName} has no available install strategy on Windows; manual installation is required.`,
    strategy,
    requiresElevation: strategy?.requiresElevation ?? false,
    interactive: strategy?.interactive ?? false,
    changesMachineState: strategy !== null,
    deferredImplementation: false,
  };
}

/** ConPTY ships with the same Windows 10 1809+ (build 17763+) baseline as WinGet. */
export function isConPtyCapable(osRelease: string): boolean {
  return isWindowsBuildWinGetCapable(osRelease);
}

export async function buildWindowsBootstrapPlan(scan: ScanResult, manifest: ToolManifest): Promise<BootstrapPlan> {
  const createdAt = new Date().toISOString();

  if (!isWindowsBuildWinGetCapable(scan.osVersion)) {
    return {
      platform: 'win32',
      createdAt,
      blocked: true,
      blockReason: `Windows build ${scan.osVersion} is below the supported minimum (10.0.17763).`,
      steps: [],
    };
  }

  const steps: PlannedStep[] = [];
  let sequence = 0;
  const winGetAvailable = scan.packageManager?.found === true;

  steps.push({
    id: 'check-winget',
    sequence: sequence++,
    toolId: null,
    kind: 'prerequisite-check',
    displayName: 'WinGet (App Installer)',
    humanExplanation: winGetAvailable
      ? `WinGet ${scan.packageManager?.version ?? ''} detected.`.trim()
      : 'WinGet was not detected. Falling back to official signed installers where available.',
    strategy: null,
    requiresElevation: false,
    interactive: false,
    changesMachineState: false,
    deferredImplementation: false,
  });

  steps.push({
    id: 'check-conpty',
    sequence: sequence++,
    toolId: null,
    kind: 'prerequisite-check',
    displayName: 'ConPTY capability',
    humanExplanation: isConPtyCapable(scan.osVersion)
      ? 'ConPTY is available for the integrated terminal.'
      : 'ConPTY is not available on this Windows build; the integrated terminal will be degraded.',
    strategy: null,
    requiresElevation: false,
    interactive: false,
    changesMachineState: false,
    deferredImplementation: false,
  });

  // Only the required essential set is ever planned for install during
  // onboarding (spec section 39: "install every optional tool during
  // onboarding" is a prohibited shortcut) — optional entries like pnpm/Bun/
  // Python are detected by performScan for display but never planned here.
  const win32Entries = manifest.entries.filter((entry) => entry.required && entry.supportedPlatforms.includes('win32'));
  const missing = win32Entries.filter((entry) => !isSatisfied(entry, scan));

  for (const entry of missing) {
    if (entry.id === 'npm') {
      continue;
    }
    if (entry.id === 'node') {
      steps.push(buildToolStep(entry, sequence++, chooseVoltaManagedStrategy(entry)));
      continue;
    }
    steps.push(buildToolStep(entry, sequence++, selectWindowsStrategy(entry, winGetAvailable)));
  }

  const npmEntry = win32Entries.find((entry) => entry.id === 'npm');
  if (npmEntry && !isSatisfied(npmEntry, scan)) {
    steps.push({
      id: 'verify-npm',
      sequence: sequence++,
      toolId: 'npm',
      kind: 'verify-only',
      displayName: npmEntry.displayName,
      humanExplanation: 'npm is installed alongside Node via Volta; verified after the Node step.',
      strategy: null,
      requiresElevation: false,
      interactive: false,
      changesMachineState: false,
      deferredImplementation: false,
    });
  }

  if (!scan.spaceShellIntegrationDetected) {
    steps.push({
      id: 'space-shell-integration',
      sequence: sequence++,
      toolId: null,
      kind: 'shell-integration',
      displayName: 'Space terminal integration (PowerShell)',
      humanExplanation:
        'Space terminal integration (PowerShell profile, spec 8.5) is not yet configured. Shell profile ' +
        'editing is owned by the terminal package (spec section 15, later phase) — surfaced for visibility only.',
      strategy: null,
      requiresElevation: false,
      interactive: false,
      changesMachineState: true,
      deferredImplementation: true,
    });
  }

  return { platform: 'win32', createdAt, blocked: false, blockReason: null, steps };
}
