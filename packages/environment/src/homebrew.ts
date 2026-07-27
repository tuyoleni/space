/**
 * Homebrew detection and install-step construction (spec section 8.4).
 * Homebrew itself is machine-scoped infrastructure, not a workspace
 * dependency (spec section 8.9) — Space only installs it when an essential
 * tool needs it and it's missing, and always shows the official source
 * first (spec 25.3.5: "HTTPS source verification").
 */
import { nodeRunCommand } from './node-adapters';
import type { CommandExecutionResult, CommandRunner, InstallStrategy, PackageManagerScanResult, PlannedStep } from './types';

export const HOMEBREW_OFFICIAL_INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';
export const HOMEBREW_OFFICIAL_SITE_URL = 'https://brew.sh';
export const HOMEBREW_LARGE_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
export const HOMEBREW_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

const TRANSIENT_HOMEBREW_FAILURE = /(?:RPC failed|HTTP\/2 stream|early EOF|fetch-pack|unexpected disconnect|curl: \(\d+\)|failed to download|network is unreachable|connection (?:reset|timed out)|could not resolve host|operation timed out|Space stopped the command)/i;

/**
 * Process-local reliability settings inherited by both Homebrew and every
 * curl/git process it starts. Nothing is written to the user's global Git
 * config. HTTP/1.1 avoids the recurring large-clone HTTP/2 stream failures;
 * low-speed tolerance keeps slow links alive instead of treating them as a
 * dead transfer; serialized downloads reduce memory/bandwidth spikes.
 */
export const HOMEBREW_RELIABILITY_ENV: Readonly<Record<string, string>> = {
  HOMEBREW_CURL_RETRIES: '5',
  HOMEBREW_DOWNLOAD_CONCURRENCY: '1',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'http.version',
  GIT_CONFIG_VALUE_0: 'HTTP/1.1',
  GIT_CONFIG_KEY_1: 'http.lowSpeedLimit',
  GIT_CONFIG_VALUE_1: '1',
  GIT_CONFIG_KEY_2: 'http.lowSpeedTime',
  GIT_CONFIG_VALUE_2: '600',
};

export interface HomebrewCommandOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly runner?: CommandRunner;
}

export async function runHomebrewCommand(
  args: readonly string[],
  options: HomebrewCommandOptions = {},
): Promise<CommandExecutionResult> {
  const runner = options.runner ?? nodeRunCommand;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let result: CommandExecutionResult = { exitCode: null, stdout: '', stderr: 'Homebrew did not run.' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- retries must be sequential; concurrent brew mutations corrupt shared state.
    result = await runner(options.executable ?? 'brew', args, {
      timeoutMs: options.timeoutMs ?? HOMEBREW_LARGE_INSTALL_TIMEOUT_MS,
      maxOutputBytes: HOMEBREW_OUTPUT_LIMIT_BYTES,
      env: HOMEBREW_RELIABILITY_ENV,
    });
    const output = `${result.stderr}\n${result.stdout}`;
    if (result.exitCode === 0 || !TRANSIENT_HOMEBREW_FAILURE.test(output)) return result;
  }
  return result;
}

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
