/**
 * PRJ-005: dependency installation — package manager detection (spec
 * section 10.5). Space detects the lockfile already present and prefers
 * the matching package manager; it must never silently convert package
 * managers or regenerate a lockfile, and when multiple incompatible
 * lockfiles exist it must surface that as a decision rather than guess.
 *
 * Composes with the existing `ProjectDetectionFsPort` (PRJ-002) rather
 * than duplicating a filesystem port.
 */
import type { ProjectDetectionFsPort } from './project-detection';

export type JsPackageManagerId = 'npm' | 'yarn' | 'pnpm';

const LOCKFILE_TO_MANAGER: Readonly<Record<string, JsPackageManagerId>> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
};

export interface LockfileMatch {
  readonly file: string;
  readonly packageManager: JsPackageManagerId;
}

export type PackageManagerResolution = 'single' | 'none' | 'conflict';

export interface PackageManagerDetection {
  readonly canonicalPath: string;
  readonly lockfilesFound: readonly LockfileMatch[];
  readonly resolution: PackageManagerResolution;
  /** Set only when `resolution === 'single'`. */
  readonly packageManager: JsPackageManagerId | null;
}

/** Read-only: lists the project root and matches known lockfile names, nothing else. */
export async function detectPackageManager(
  canonicalPath: string,
  fs: ProjectDetectionFsPort,
): Promise<PackageManagerDetection> {
  const entries = await fs.listDirectory(canonicalPath);
  const lockfilesFound: LockfileMatch[] = [];
  for (const entry of entries) {
    const packageManager = LOCKFILE_TO_MANAGER[entry];
    if (packageManager) {
      lockfilesFound.push({ file: entry, packageManager });
    }
  }

  const distinctManagers = new Set(lockfilesFound.map((match) => match.packageManager));
  if (distinctManagers.size === 0) {
    return { canonicalPath, lockfilesFound, resolution: 'none', packageManager: null };
  }
  if (distinctManagers.size > 1) {
    return { canonicalPath, lockfilesFound, resolution: 'conflict', packageManager: null };
  }
  return {
    canonicalPath,
    lockfilesFound,
    resolution: 'single',
    packageManager: [...distinctManagers][0] ?? null,
  };
}

export interface InstallCommand {
  readonly executable: JsPackageManagerId;
  readonly args: readonly string[];
}

/**
 * The non-interactive install command for a resolved package manager. Uses
 * each tool's plain "install" so the existing lockfile is respected and
 * never regenerated — no `--force`, no `--package-lock-only` mutation.
 */
export function installCommandFor(packageManager: JsPackageManagerId): InstallCommand {
  switch (packageManager) {
    case 'npm':
      return { executable: 'npm', args: ['install'] };
    case 'yarn':
      return { executable: 'yarn', args: ['install'] };
    case 'pnpm':
      return { executable: 'pnpm', args: ['install'] };
    default: {
      const exhaustive: never = packageManager;
      throw new Error(`Unknown package manager: ${String(exhaustive)}`);
    }
  }
}

/**
 * The non-interactive update command for a resolved package manager. Uses
 * each tool's semver-respecting update (never a forced major jump or a
 * package.json range rewrite) so it's safe to run without further prompts.
 */
export function updateCommandFor(packageManager: JsPackageManagerId): InstallCommand {
  switch (packageManager) {
    case 'npm':
      return { executable: 'npm', args: ['update'] };
    case 'yarn':
      return { executable: 'yarn', args: ['upgrade'] };
    case 'pnpm':
      return { executable: 'pnpm', args: ['update'] };
    default: {
      const exhaustive: never = packageManager;
      throw new Error(`Unknown package manager: ${String(exhaustive)}`);
    }
  }
}
