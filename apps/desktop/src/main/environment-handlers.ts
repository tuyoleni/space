/**
 * Real, read-only machine scan exposed to the renderer — thin adapter over
 * @space/environment's already-tested `performScan`/`createNodeScanDependencies`
 * (spec section 8.2, ONB-002; proven against the real machine in
 * tests/integration/m3-real-scan.test.ts). This module owns nothing new:
 * it only maps that package's result shape onto the renderer-safe
 * contracts types (@space/environment must never enter the renderer
 * bundle — spec section 32), enriching each tool with the manifest's
 * display name so the UI never has to know tool ids.
 *
 * It also owns two small, real enrichments beyond the base scan:
 *  - `source`/`latestVersion`/`updateAvailable`, derived from the tool's
 *    real resolved path and (for Homebrew-sourced tools only) a real
 *    `brew info --json=v2` lookup — never guessed, never a network call
 *    beyond that one already-trusted package manager.
 *  - `shellName`/`shellVersion`, derived from the real `shellPath` the
 *    scan already resolved.
 *
 * And two real install/update actions (installTool/updateTool) that run
 * the manifest's own install strategy for the current platform via
 * `nodeRunCommand` — never a bare shell string. Trust/consent gating for
 * these (PRJ-003 allow-once semantics) happens at the IPC layer, owned
 * elsewhere; this module only executes once asked.
 */
import path from 'node:path';
import os from 'node:os';
import { createNodeScanDependencies, nodeRunCommand, performScan, TOOL_MANIFEST, compareVersions } from '@space/environment';
import type { InstallStrategy } from '@space/environment';
import type {
  EnvironmentScanInput,
  EnvironmentScanResult,
  EnvironmentScanToolResult,
  EnvironmentToolActionInput,
  EnvironmentToolActionResult,
} from '@space/contracts';

/** The real `git config --global user.name` — null when unset or git is absent, never a guess. */
async function readGitUserName(): Promise<string | null> {
  const result = await nodeRunCommand('git', ['config', '--global', '--get', 'user.name'], { timeoutMs: 5_000 }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return null;
  }
  const name = result.stdout.trim();
  return name.length > 0 ? name : null;
}

/**
 * Classifies a tool's install origin from its real resolved path using
 * well-known install-layout conventions. Never guesses from the tool's
 * manifest strategy — a tool can be installed a different way than its
 * "preferred" strategy, so only the actual path on disk is trusted.
 */
export function resolveToolSource(resolvedPath: string | null): string | null {
  if (resolvedPath === null) {
    return null;
  }
  if (resolvedPath.includes('/opt/homebrew/') || resolvedPath.includes('/usr/local/Cellar/')) {
    return 'Homebrew';
  }
  if (resolvedPath.includes('/.volta/')) {
    return 'Volta';
  }
  if (resolvedPath.includes('/.nvm/')) {
    return 'nvm';
  }
  return 'System';
}

/** Homebrew formula name for a tool id, where it differs from the id itself. */
const HOMEBREW_FORMULA_BY_TOOL_ID: Readonly<Record<string, string>> = {
  python: 'python3',
};

/**
 * Real newest-version lookup for a Homebrew-installed tool via
 * `brew info --json=v2 <formula>` — the only network-adjacent call this
 * module makes, and only through the already-trusted Homebrew CLI, never a
 * direct registry/API fetch. Null on any failure or unparseable output,
 * never a guess.
 */
async function lookupHomebrewLatestVersion(formula: string): Promise<string | null> {
  const result = await nodeRunCommand('brew', ['info', '--json=v2', formula], { timeoutMs: 10_000 }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as { formulae?: ReadonlyArray<{ versions?: { stable?: string } }> };
    const stable = parsed.formulae?.[0]?.versions?.stable;
    return typeof stable === 'string' && stable.length > 0 ? stable : null;
  } catch {
    return null;
  }
}

interface ToolEnrichment {
  readonly toolId: string;
  readonly source: string | null;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean | null;
}

/** Computes source/latestVersion/updateAvailable for one scanned tool. Cheap/reliable lookups only — never fabricated. */
async function enrichTool(tool: { toolId: string; found: boolean; path: string | null; version: string | null }): Promise<ToolEnrichment> {
  const source = resolveToolSource(tool.path);
  if (source !== 'Homebrew' || !tool.found) {
    return { toolId: tool.toolId, source, latestVersion: null, updateAvailable: null };
  }

  const formula = HOMEBREW_FORMULA_BY_TOOL_ID[tool.toolId] ?? tool.toolId;
  const latestVersion = await lookupHomebrewLatestVersion(formula);
  let updateAvailable: boolean | null = null;
  if (latestVersion !== null && tool.version !== null) {
    try {
      updateAvailable = compareVersions(latestVersion, tool.version) > 0;
    } catch {
      updateAvailable = null;
    }
  }
  return { toolId: tool.toolId, source, latestVersion, updateAvailable };
}

/** Basename of a shell path ("zsh", "bash") — null when the shell path is unknown. */
function resolveShellName(shellPath: string | null): string | null {
  if (shellPath === null) {
    return null;
  }
  const base = path.basename(shellPath);
  return base.length > 0 ? base : null;
}

/** Real `<shellPath> --version` output, parsed — null on any failure (zsh/bash both support `--version`). */
async function resolveShellVersion(shellPath: string | null): Promise<string | null> {
  if (shellPath === null) {
    return null;
  }
  const result = await nodeRunCommand(shellPath, ['--version'], { timeoutMs: 5_000 }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return null;
  }
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(`${result.stdout}\n${result.stderr}`);
  return match?.[1] ?? null;
}

/** Picks the install strategy matching the running platform, or null if the tool has none there. */
function chooseStrategyForCurrentPlatform(strategies: readonly InstallStrategy[]): InstallStrategy | null {
  const platform = process.platform === 'win32' ? 'win32' : 'darwin';
  return strategies.find((strategy) => strategy.platform === platform) ?? null;
}

/**
 * Builds the real command-line args for an install or update action.
 * The manifest only encodes a single "install" strategy per platform (spec
 * 8.3), so "update" derives the real upgrade verb for the same package
 * manager rather than inventing a new manifest field:
 *  - Homebrew: `brew upgrade <formula>`
 *  - WinGet: `winget upgrade --id <id> -e --accept-package-agreements --accept-source-agreements`
 *  - volta-managed / official-installer: re-running the install strategy is
 *    already correct (volta re-resolves to latest matching semver; official
 *    installers are idempotent re-installs) — there is no distinct upgrade verb.
 */
function buildActionArgs(strategy: InstallStrategy, action: 'install' | 'update'): readonly string[] {
  if (action === 'install') {
    return strategy.args;
  }
  if (strategy.packageManagerId === 'homebrew' && strategy.packageId) {
    return ['upgrade', strategy.packageId];
  }
  if (strategy.packageManagerId === 'winget' && strategy.packageId) {
    return ['upgrade', '--id', strategy.packageId, '-e', '--accept-package-agreements', '--accept-source-agreements'];
  }
  return strategy.args;
}

/** Runs the real install/update strategy for a tool id on the current platform. Never throws — failures come back as `succeeded: false`. */
async function runToolAction(toolId: string, action: 'install' | 'update'): Promise<EnvironmentToolActionResult> {
  const entry = TOOL_MANIFEST.entries.find((candidate) => candidate.id === toolId);
  if (!entry) {
    return { toolId, succeeded: false, exitCode: null, message: `"${toolId}" is not a known tool.` };
  }

  const strategy = chooseStrategyForCurrentPlatform(entry.installStrategies);
  if (!strategy) {
    return {
      toolId,
      succeeded: false,
      exitCode: null,
      message: `${entry.displayName} has no available ${action} strategy on ${process.platform}; see ${entry.uninstallGuidance ?? entry.installStrategies[0]?.officialSourceUrl ?? 'the official docs'}.`,
    };
  }

  const args = buildActionArgs(strategy, action);
  const result = await nodeRunCommand(strategy.executable, args, { timeoutMs: 120_000 }).catch((error: unknown) => ({
    exitCode: null as number | null,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  const succeeded = result.exitCode === 0;
  if (succeeded) {
    return {
      toolId,
      succeeded: true,
      exitCode: result.exitCode,
      message: `${entry.displayName} ${action === 'install' ? 'installed' : 'updated'} via ${strategy.sourceDescription}.`,
    };
  }

  const tail = (result.stderr || result.stdout).trim().slice(-500);
  return {
    toolId,
    succeeded: false,
    exitCode: result.exitCode,
    message: tail.length > 0 ? tail : `${entry.displayName} ${action} failed.`,
  };
}

export interface EnvironmentHandlers {
  scan(input: EnvironmentScanInput): Promise<EnvironmentScanResult>;
  installTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult>;
  updateTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult>;
}

export function createEnvironmentHandlers(): EnvironmentHandlers {
  async function scan(input: EnvironmentScanInput): Promise<EnvironmentScanResult> {
    const defaultProjectLocation = input.defaultProjectLocation ?? os.homedir();
    const deps = createNodeScanDependencies(defaultProjectLocation);
    const [result, gitUserName] = await Promise.all([performScan(TOOL_MANIFEST, deps), readGitUserName()]);

    const displayNameByToolId = new Map(TOOL_MANIFEST.entries.map((entry) => [entry.id, entry.displayName]));

    // Enrichment (source classification + Homebrew latest-version lookup,
    // shell name/version) depends on the scan's resolved paths, so it runs
    // as a second concurrent wave rather than alongside performScan itself.
    const [enrichments, shellName, shellVersion] = await Promise.all([
      Promise.all(result.tools.map((tool) => enrichTool(tool))),
      Promise.resolve(resolveShellName(result.shellPath)),
      resolveShellVersion(result.shellPath),
    ]);
    const enrichmentByToolId = new Map(enrichments.map((enrichment) => [enrichment.toolId, enrichment]));

    const tools: EnvironmentScanToolResult[] = result.tools.map((tool) => {
      const enrichment = enrichmentByToolId.get(tool.toolId);
      return {
        toolId: tool.toolId,
        displayName: displayNameByToolId.get(tool.toolId) ?? tool.toolId,
        found: tool.found,
        path: tool.path,
        version: tool.version,
        meetsMinimumVersion: tool.meetsMinimumVersion,
        source: enrichment?.source ?? null,
        latestVersion: enrichment?.latestVersion ?? null,
        updateAvailable: enrichment?.updateAvailable ?? null,
      };
    });

    return {
      scannedAt: new Date().toISOString(),
      platform: result.platform,
      architecture: result.architecture,
      osVersion: result.osVersion,
      diskFreeBytes: result.diskFreeBytes,
      shellAvailable: result.shellAvailable,
      shellPath: result.shellPath,
      shellName,
      shellVersion,
      packageManager: result.packageManager,
      defaultProjectLocation: result.defaultProjectLocation,
      gitUserName,
      tools,
    };
  }

  async function installTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult> {
    // `input.allowOnce` is intentionally unused here — trust/consent gating
    // for install/update actions happens at the IPC layer (mirrors PRJ-003
    // allow-once semantics in project-handlers.ts's installDependencies).
    return runToolAction(input.toolId, 'install');
  }

  async function updateTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult> {
    return runToolAction(input.toolId, 'update');
  }

  return { scan, installTool, updateTool };
}
