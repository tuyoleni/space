/**
 * ONB-004: macOS bootstrap plan (spec section 8.4).
 */
import { buildHomebrewInstallStep, needsHomebrew } from './homebrew';
import { meetsMinimumVersion } from './version';
import type {
  BootstrapPlan,
  CommandOnPathResolver,
  InstallStrategy,
  PlannedStep,
  ScanResult,
  ToolManifest,
  ToolManifestEntry,
} from './types';

/** macOS 13 (Ventura) — matches the target platform commitment in spec section 1.1/30. */
export const MINIMUM_MACOS_VERSION = '13.0.0';

function isSatisfied(entry: ToolManifestEntry, scan: ScanResult): boolean {
  const found = scan.tools.find((tool) => tool.toolId === entry.id);
  if (!found?.found) {
    return false;
  }
  return meetsMinimumVersion(found.version, entry.minimumVersion) !== false;
}

function chooseHomebrewStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'darwin' && s.kind === 'package-manager') ?? null;
}

function chooseVoltaManagedStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'darwin' && s.kind === 'volta-managed') ?? null;
}

function chooseOfficialInstallerStrategy(entry: ToolManifestEntry): InstallStrategy | null {
  return entry.installStrategies.find((s) => s.platform === 'darwin' && s.kind === 'official-installer') ?? null;
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
      : `${entry.displayName} has no available install strategy on macOS; manual installation is required.`,
    strategy,
    requiresElevation: strategy?.requiresElevation ?? false,
    interactive: strategy?.interactive ?? false,
    changesMachineState: strategy !== null,
    deferredImplementation: false,
  };
}

/**
 * Checks Apple Command Line Tools availability via `xcode-select -p`, which
 * prints the active developer directory path and exits non-zero if CLT
 * (or a full Xcode install) isn't present. Read-only (spec 8.2/8.4).
 */
export async function checkAppleCommandLineTools(resolveOnPath: CommandOnPathResolver): Promise<boolean> {
  const path = await resolveOnPath('xcode-select');
  return path !== null;
}

export interface BuildMacOsPlanOptions {
  readonly appleCommandLineToolsInstalled: boolean;
}

export async function buildMacOsBootstrapPlan(
  scan: ScanResult,
  manifest: ToolManifest,
  options: BuildMacOsPlanOptions,
): Promise<BootstrapPlan> {
  const createdAt = new Date().toISOString();

  if (meetsMinimumVersion(scan.osVersion, MINIMUM_MACOS_VERSION) === false) {
    return {
      platform: 'darwin',
      createdAt,
      blocked: true,
      blockReason: `macOS ${scan.osVersion} is below the supported minimum (${MINIMUM_MACOS_VERSION}).`,
      steps: [],
    };
  }

  const steps: PlannedStep[] = [];
  let sequence = 0;

  steps.push({
    id: 'check-apple-command-line-tools',
    sequence: sequence++,
    toolId: null,
    kind: 'prerequisite-check',
    displayName: 'Apple Command Line Tools',
    humanExplanation: options.appleCommandLineToolsInstalled
      ? 'Apple Command Line Tools detected.'
      : 'Apple Command Line Tools were not detected. Some Homebrew installs may prompt to install them; Space shows that prompt as-is.',
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
  const darwinEntries = manifest.entries.filter((entry) => entry.required && entry.supportedPlatforms.includes('darwin'));
  const missing = darwinEntries.filter((entry) => !isSatisfied(entry, scan));

  const homebrewStrategiesNeeded = missing
    .filter((entry) => entry.id !== 'node') // node installs via volta, not homebrew
    .map((entry) => chooseHomebrewStrategy(entry));

  if (needsHomebrew(homebrewStrategiesNeeded) && scan.packageManager?.found !== true) {
    steps.push(buildHomebrewInstallStep(sequence++, scan.architecture));
  }

  for (const entry of missing) {
    if (entry.id === 'npm') {
      // npm has no independent strategy — it arrives with the Node step below.
      continue;
    }
    if (entry.id === 'node') {
      steps.push(buildToolStep(entry, sequence++, chooseVoltaManagedStrategy(entry)));
      continue;
    }
    const strategy = chooseHomebrewStrategy(entry) ?? chooseOfficialInstallerStrategy(entry);
    steps.push(buildToolStep(entry, sequence++, strategy));
  }

  const npmEntry = darwinEntries.find((entry) => entry.id === 'npm');
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
      displayName: 'Space terminal integration',
      humanExplanation:
        'Space terminal integration is not yet configured. Shell profile editing is owned by the terminal ' +
        'package (spec section 15, later phase) — this step is surfaced for visibility but not executed yet.',
      strategy: null,
      requiresElevation: false,
      interactive: false,
      changesMachineState: true,
      deferredImplementation: true,
    });
  }

  return { platform: 'darwin', createdAt, blocked: false, blockReason: null, steps };
}
