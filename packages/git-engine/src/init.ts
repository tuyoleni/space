/**
 * GIT-002: Git initialisation preflight (spec 11.5). Before `git init`,
 * Space must check for an enclosing parent repository, determine the
 * requested default branch, confirm write access, and flag likely secrets
 * and generated directories. This composes with M4's project detection
 * (PRJ-002, @space/environment `detectProject`) rather than duplicating
 * it — callers pass in the already-computed detection facts.
 */
import { initArgs, repositoryRootArgs } from './commands';
import type { GitExecutor } from './clone';

export function resolveDefaultBranchName(requested?: string): string {
  const trimmed = requested?.trim();
  if (!trimmed) {
    return 'main';
  }
  if (/\s/.test(trimmed) || trimmed.startsWith('-') || trimmed.toUpperCase() === 'HEAD') {
    throw new Error(`"${requested}" is not a valid default branch name`);
  }
  return trimmed;
}

/**
 * Returns the enclosing repository's toplevel path if `targetDir` is
 * already inside a Git working tree, or null if it is not (safe to
 * initialise). Runs `rev-parse --show-toplevel` with `cwd: targetDir`
 * *before* any `.git` exists there — git walks up ancestor directories to
 * find one, so a non-zero exit genuinely means "no enclosing repository".
 */
export async function checkForEnclosingRepository(
  targetDir: string,
  executor: GitExecutor,
): Promise<string | null> {
  const result = await executor(repositoryRootArgs(), { cwd: targetDir });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export interface LikelySensitiveFact {
  readonly category: string;
  readonly label: string;
}

export interface DetectedRisks {
  readonly likelySecrets: readonly string[];
  readonly likelyGeneratedDirectories: readonly string[];
}

export function classifyDetectedRisks(facts: readonly LikelySensitiveFact[]): DetectedRisks {
  return {
    likelySecrets: facts.filter((fact) => fact.category === 'env-file').map((fact) => fact.label),
    likelyGeneratedDirectories: facts
      .filter((fact) => fact.category === 'generated-directory')
      .map((fact) => fact.label),
  };
}

export interface InitPreflightResult extends DetectedRisks {
  readonly defaultBranch: string;
  /** Non-null: the toplevel path of the enclosing repository (nesting risk). */
  readonly nestedRepositoryWarning: string | null;
  readonly writeAccess: boolean;
  /** False when write access is denied — the UI must not offer to proceed. */
  readonly canProceed: boolean;
}

export interface InitPreflightOptions {
  readonly executor: GitExecutor;
  readonly canWrite: (dir: string) => Promise<boolean>;
  readonly detectedFacts?: readonly LikelySensitiveFact[];
}

export async function runInitPreflight(
  targetDir: string,
  requestedDefaultBranch: string | undefined,
  options: InitPreflightOptions,
): Promise<InitPreflightResult> {
  const defaultBranch = resolveDefaultBranchName(requestedDefaultBranch);
  const [nestedRepositoryWarning, writeAccess] = await Promise.all([
    checkForEnclosingRepository(targetDir, options.executor),
    options.canWrite(targetDir),
  ]);
  const risks = classifyDetectedRisks(options.detectedFacts ?? []);
  return {
    defaultBranch,
    nestedRepositoryWarning,
    writeAccess,
    canProceed: writeAccess,
    ...risks,
  };
}

/** Runs the real `git init` (spec 39: never treat exit 0 alone as "verified" — callers must re-check state afterward). */
export async function initRepository(
  targetDir: string,
  defaultBranch: string,
  executor: GitExecutor,
): Promise<void> {
  const result = await executor(initArgs(defaultBranch), { cwd: targetDir });
  if (result.exitCode !== 0) {
    throw new Error(`git init failed: ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}
