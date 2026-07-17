/**
 * Real dependency health for one project: `npm|pnpm audit --json` and
 * `npm|pnpm outdated --json`, run read-only against the project's real
 * directory and parsed as-is — never `audit fix`, never an install.
 * Reuses @space/environment's `nodeRunCommand` (spec 25.3.2: never
 * `shell: true`), the same safe-spawn primitive the machine scan uses.
 *
 * Both `npm audit` and `npm outdated` intentionally exit non-zero when
 * they find something to report, so exit code is ignored here — only
 * whether stdout parses as the JSON shape each tool documents.
 */
import { nodeRunCommand } from '@space/environment';
import type {
  DependencyScanInput,
  DependencyScanResult,
  JsPackageManagerId,
  OutdatedPackageInfo,
  VulnerabilitySeverityCounts,
} from '@space/contracts';

const AUDIT_TIMEOUT_MS = 30_000;

function parseAuditCounts(stdout: string): VulnerabilitySeverityCounts | null {
  try {
    const parsed = JSON.parse(stdout) as { metadata?: { vulnerabilities?: Partial<VulnerabilitySeverityCounts> } };
    const counts = parsed.metadata?.vulnerabilities;
    if (!counts) {
      return null;
    }
    return {
      info: counts.info ?? 0,
      low: counts.low ?? 0,
      moderate: counts.moderate ?? 0,
      high: counts.high ?? 0,
      critical: counts.critical ?? 0,
      total: counts.total ?? 0,
    };
  } catch {
    return null;
  }
}

function parseOutdatedPackages(stdout: string): OutdatedPackageInfo[] | null {
  try {
    const parsed = JSON.parse(stdout.trim() || '{}') as Record<
      string,
      { current?: string; wanted?: string; latest?: string } | { current?: string; wanted?: string; latest?: string }[]
    >;
    return Object.entries(parsed).map(([name, value]) => {
      // pnpm can emit an array per package when it appears in several
      // importers; npm emits a single object. Take the first entry either way.
      const info = Array.isArray(value) ? value[0] : value;
      return {
        name,
        current: info?.current ?? null,
        wanted: info?.wanted ?? null,
        latest: info?.latest ?? null,
      };
    });
  } catch {
    return null;
  }
}

export interface DependencyHandlers {
  scan(input: DependencyScanInput): Promise<DependencyScanResult>;
}

export function createDependencyHandlers(): DependencyHandlers {
  async function scan(input: DependencyScanInput): Promise<DependencyScanResult> {
    const scannedAt = new Date().toISOString();

    if (input.packageManager === 'yarn') {
      return {
        scannedAt,
        packageManager: input.packageManager,
        supported: false,
        reason: 'Yarn audit output is not parsed yet — run `yarn audit` in a terminal for now.',
        vulnerabilities: null,
        outdatedCount: null,
        outdatedPackages: null,
      };
    }

    const executable: JsPackageManagerId = input.packageManager;
    const [auditResult, outdatedResult] = await Promise.all([
      nodeRunCommand(executable, ['audit', '--json'], { cwd: input.canonicalPath, timeoutMs: AUDIT_TIMEOUT_MS }).catch(() => null),
      nodeRunCommand(executable, ['outdated', '--json'], { cwd: input.canonicalPath, timeoutMs: AUDIT_TIMEOUT_MS }).catch(() => null),
    ]);

    const vulnerabilities = auditResult ? parseAuditCounts(auditResult.stdout) : null;
    const outdatedPackages = outdatedResult ? parseOutdatedPackages(outdatedResult.stdout) : null;
    const supported = vulnerabilities !== null || outdatedPackages !== null;

    return {
      scannedAt,
      packageManager: input.packageManager,
      supported,
      reason: supported ? null : `Could not run "${executable} audit"/"${executable} outdated" — is ${executable} installed and on PATH?`,
      vulnerabilities,
      outdatedCount: outdatedPackages ? outdatedPackages.length : null,
      outdatedPackages,
    };
  }

  return { scan };
}
