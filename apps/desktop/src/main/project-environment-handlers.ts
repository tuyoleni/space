/**
 * Real per-project runtime/package-manager/lockfile/scripts/env-var summary
 * for the Environment screen's "Project Environment" panel. Reuses
 * @space/environment's existing lockfile detection (`detectPackageManager`
 * + `nodeProjectDetectionFs`, PRJ-005) rather than re-implementing it, and
 * `nodeRunCommand` (the same safe-spawn primitive dependency-handlers.ts
 * and environment-handlers.ts use, spec 25.3.2: never `shell: true`) for
 * the one real command this needs — `node --version` — when neither a
 * Volta pin nor `.nvmrc` already answers the runtime question. Env var
 * *values* are never read, only key names (spec 25.1's protected-asset
 * discipline extends to display, not just execution).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPackageManager, nodeProjectDetectionFs, nodeRunCommand } from '@space/environment';
import type { Project, ProjectEnvironmentInfo, ProjectEnvironmentInfoInput } from '@space/contracts';
import type { StorageCaller } from './project-handlers';

const NODE_VERSION_TIMEOUT_MS = 5_000;
const ENV_FILE_CANDIDATES = ['.env', '.env.local'] as const;

interface PackageJsonShape {
  readonly scripts?: unknown;
  readonly volta?: { readonly node?: unknown };
}

async function readPackageJson(canonicalPath: string): Promise<PackageJsonShape | null> {
  try {
    const raw = await fs.readFile(path.join(canonicalPath, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PackageJsonShape) : null;
  } catch {
    // No package.json (or it's unreadable/malformed) — not every project is
    // JS, and that's a normal, non-error state here, never guessed at.
    return null;
  }
}

function readScriptNames(packageJson: PackageJsonShape | null): string[] {
  const scripts = packageJson?.scripts;
  return scripts && typeof scripts === 'object' ? Object.keys(scripts as Record<string, unknown>) : [];
}

function resolveVoltaPin(packageJson: PackageJsonShape | null): string | null {
  const nodeVersion = packageJson?.volta?.node;
  return typeof nodeVersion === 'string' && nodeVersion.trim().length > 0 ? nodeVersion.trim() : null;
}

async function readNvmrc(canonicalPath: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(path.join(canonicalPath, '.nvmrc'), 'utf-8');
    const trimmed = contents.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Real `node --version` in the project's own directory (respects local nvm/volta shims) — never guessed. */
async function readSystemNodeVersion(canonicalPath: string): Promise<string | null> {
  const result = await nodeRunCommand('node', ['--version'], { cwd: canonicalPath, timeoutMs: NODE_VERSION_TIMEOUT_MS }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return null;
  }
  const version = result.stdout.trim();
  return version.length > 0 ? version : null;
}

/** Names only (never values) from the first of `.env`/`.env.local` that exists and is readable. */
function parseEnvVariableNames(fileContents: string): string[] {
  const names: string[] = [];
  for (const line of fileContents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    if (name) {
      names.push(name);
    }
  }
  return names;
}

async function readEnvFile(canonicalPath: string): Promise<{ envFileName: string | null; envVariableNames: string[] }> {
  for (const candidate of ENV_FILE_CANDIDATES) {
    const target = path.join(canonicalPath, candidate);
    try {
      await fs.access(target);
    } catch {
      continue;
    }
    try {
      const contents = await fs.readFile(target, 'utf-8');
      return { envFileName: candidate, envVariableNames: parseEnvVariableNames(contents) };
    } catch {
      continue;
    }
  }
  return { envFileName: null, envVariableNames: [] };
}

export interface ProjectEnvironmentHandlers {
  environmentInfo(input: ProjectEnvironmentInfoInput): Promise<ProjectEnvironmentInfo>;
}

export function createProjectEnvironmentHandlers(storage: StorageCaller): ProjectEnvironmentHandlers {
  async function environmentInfo(input: ProjectEnvironmentInfoInput): Promise<ProjectEnvironmentInfo> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const canonicalPath = project.canonicalPath;

    const [detection, packageJson, envFile] = await Promise.all([
      detectPackageManager(canonicalPath, nodeProjectDetectionFs),
      readPackageJson(canonicalPath),
      readEnvFile(canonicalPath),
    ]);

    const packageManager = detection.resolution === 'single' ? detection.packageManager : null;
    const lockfileDetected = detection.lockfilesFound.length > 0;
    const lockfileName = detection.lockfilesFound[0]?.file ?? null;
    const scriptNames = readScriptNames(packageJson);

    let runtimeVersion: string | null;
    let runtimeSource: string | null;
    const voltaPin = resolveVoltaPin(packageJson);
    if (voltaPin) {
      runtimeVersion = voltaPin;
      runtimeSource = 'via Volta';
    } else {
      const nvmrcVersion = await readNvmrc(canonicalPath);
      if (nvmrcVersion) {
        runtimeVersion = nvmrcVersion;
        runtimeSource = 'via .nvmrc';
      } else {
        const systemVersion = await readSystemNodeVersion(canonicalPath);
        runtimeVersion = systemVersion;
        runtimeSource = systemVersion ? 'system' : null;
      }
    }

    return {
      projectId: input.projectId,
      runtimeToolId: 'node',
      runtimeVersion,
      runtimeSource,
      packageManager,
      lockfileDetected,
      lockfileName,
      scriptNames,
      envVariableNames: envFile.envVariableNames,
      envFileName: envFile.envFileName,
    };
  }

  return { environmentInfo };
}
