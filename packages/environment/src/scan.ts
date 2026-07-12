/**
 * ONB-002: non-mutating scan (spec section 8.2).
 *
 * Hard requirement: this module MUST NOT modify PATH, install software,
 * authenticate services, or create repositories. Every dependency it
 * touches (`ScanDependencies`) is read-only by construction — there is no
 * write/spawn-for-mutation primitive available to this function at all,
 * so a reviewer can see the constraint is structural, not just observed.
 */
import type { EditorDetectionResult, PackageManagerScanResult, ScanDependencies, ScanResult, ScanToolResult, ToolManifest } from './types';
import { extractVersion, meetsMinimumVersion } from './version';

const KNOWN_EDITORS: ReadonlyArray<{ id: string; displayName: string; executable: string }> = [
  { id: 'vscode', displayName: 'Visual Studio Code', executable: 'code' },
  { id: 'cursor', displayName: 'Cursor', executable: 'cursor' },
  { id: 'zed', displayName: 'Zed', executable: 'zed' },
];

const SPACE_SHELL_INTEGRATION_MARKER = '# space-shell-integration';

async function scanTool(entry: ToolManifest['entries'][number], deps: ScanDependencies): Promise<ScanToolResult> {
  const commandRule = entry.detection.find((rule) => rule.kind === 'command-on-path');
  const versionRule = entry.detection.find((rule) => rule.kind === 'version-command');
  const executable = commandRule?.executable ?? versionRule?.executable ?? entry.id;

  const resolvedPath = await deps.resolveOnPath(executable);
  if (resolvedPath === null) {
    return { toolId: entry.id, found: false, path: null, version: null, meetsMinimumVersion: null };
  }

  let version: string | null = null;
  if (versionRule?.versionArgs && versionRule.versionPattern) {
    const result = await deps.runCommand(executable, versionRule.versionArgs, { timeoutMs: 5000 });
    version = extractVersion(`${result.stdout}\n${result.stderr}`, versionRule.versionPattern);
  }

  return {
    toolId: entry.id,
    found: true,
    path: resolvedPath,
    version,
    meetsMinimumVersion: meetsMinimumVersion(version, entry.minimumVersion),
  };
}

async function scanPackageManager(deps: ScanDependencies): Promise<PackageManagerScanResult | null> {
  const platform = deps.os.platform();
  if (platform === 'darwin') {
    const appleSilicon = '/opt/homebrew/bin/brew';
    const intel = '/usr/local/bin/brew';
    const path = (await deps.fs.exists(appleSilicon))
      ? appleSilicon
      : (await deps.fs.exists(intel))
        ? intel
        : await deps.resolveOnPath('brew');
    if (path === null) {
      return { id: 'homebrew', found: false, path: null, version: null };
    }
    const result = await deps.runCommand(path, ['--version'], { timeoutMs: 5000 });
    const version = extractVersion(result.stdout, 'Homebrew (\\S+)');
    return { id: 'homebrew', found: true, path, version };
  }

  // win32
  const path = await deps.resolveOnPath('winget');
  if (path === null) {
    return { id: 'winget', found: false, path: null, version: null };
  }
  const result = await deps.runCommand(path, ['--version'], { timeoutMs: 5000 });
  const version = extractVersion(result.stdout, '(v?\\d+\\.\\d+(?:\\.\\d+)?)');
  return { id: 'winget', found: true, path, version };
}

async function scanEditors(deps: ScanDependencies): Promise<EditorDetectionResult[]> {
  const results: EditorDetectionResult[] = [];
  for (const editor of KNOWN_EDITORS) {
    const path = await deps.resolveOnPath(editor.executable);
    results.push({ id: editor.id, displayName: editor.displayName, found: path !== null, path });
  }
  return results;
}

async function detectSpaceShellIntegration(deps: ScanDependencies): Promise<boolean> {
  const platform = deps.os.platform();
  const home = deps.os.homeDir();
  const candidates =
    platform === 'darwin'
      ? [`${home}/.zshrc`, `${home}/.bash_profile`, `${home}/.bashrc`]
      : [`${home}\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1`];

  for (const candidate of candidates) {
    const content = await deps.fs.readTextFile(candidate);
    if (content?.includes(SPACE_SHELL_INTEGRATION_MARKER)) {
      return true;
    }
  }
  return false;
}

/** Runs the full ONB-002 scan against `manifest`'s tools using the injected read-only ports. */
export async function performScan(manifest: ToolManifest, deps: ScanDependencies): Promise<ScanResult> {
  const platform = deps.os.platform();
  const relevantEntries = manifest.entries.filter((entry) => entry.supportedPlatforms.includes(platform));

  const [diskFreeBytes, packageManager, editors, spaceShellIntegrationDetected, canWriteDefaultProjectLocation, tools] =
    await Promise.all([
      deps.os.diskFreeBytes(deps.defaultProjectLocation),
      scanPackageManager(deps),
      scanEditors(deps),
      detectSpaceShellIntegration(deps),
      deps.fs.canWrite(deps.defaultProjectLocation),
      Promise.all(relevantEntries.map((entry) => scanTool(entry, deps))),
    ]);

  const shellPath = deps.os.shellPath();

  return {
    scannedAt: new Date().toISOString(),
    platform,
    architecture: deps.os.architecture(),
    osVersion: deps.os.release(),
    diskFreeBytes,
    shellAvailable: shellPath !== null,
    shellPath,
    packageManager,
    tools,
    editors,
    spaceShellIntegrationDetected,
    defaultProjectLocation: deps.defaultProjectLocation,
    canWriteDefaultProjectLocation,
  };
}
