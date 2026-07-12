/**
 * ONB-007: verification (spec section 8.7).
 *
 * "A tool is not considered installed merely because an installer returned
 * zero." Note the function signature below: it never accepts an installer
 * exit code as input at all — verification is entirely re-derived from a
 * freshly constructed environment (fresh PATH resolution, a real version
 * command, a real functional command), so there is no code path by which
 * an installer's reported success could influence the verdict (spec
 * section 39, prohibited shortcut).
 */
import { extractVersion, meetsMinimumVersion } from './version';
import type { CommandOnPathResolver, CommandRunner, ToolManifestEntry, VerificationOutcome } from './types';

export interface VerifyDependencies {
  readonly resolveOnPath: CommandOnPathResolver;
  readonly runCommand: CommandRunner;
  readonly architecture: string;
}

function architectureCompatible(entry: ToolManifestEntry, architecture: string): boolean {
  return entry.architectures.length === 0 || entry.architectures.includes(architecture);
}

export async function verifyTool(entry: ToolManifestEntry, deps: VerifyDependencies): Promise<VerificationOutcome> {
  // Fresh resolution: never reuse a path captured during scan or reported
  // by the installer step — PATH may have changed (e.g. Volta shims).
  const resolvedPath = await deps.resolveOnPath(entry.detection[0]?.executable ?? entry.id);
  if (resolvedPath === null) {
    return {
      toolId: entry.id,
      resolved: false,
      resolvedPath: null,
      versionOutput: null,
      version: null,
      meetsMinimumVersion: null,
      functionalCheckPassed: null,
      architectureCompatible: null,
      needsRestart: false,
      verified: false,
      failureReason: 'Executable could not be resolved from a freshly constructed environment.',
    };
  }

  let versionOutput: string | null = null;
  let version: string | null = null;
  let versionRuleFailed = false;

  for (const rule of entry.verify) {
    const result = await deps.runCommand(resolvedPath, rule.args, { timeoutMs: 10_000 });
    const combined = `${result.stdout}\n${result.stderr}`;

    if (rule.kind === 'version-output') {
      versionOutput = combined.trim();
      if (rule.expectedPattern && !new RegExp(rule.expectedPattern).test(combined)) {
        versionRuleFailed = true;
      }
      // Extract using the entry's own detection pattern for a normalised version string.
      const detectionRule = entry.detection.find((d) => d.kind === 'version-command');
      if (detectionRule?.versionPattern) {
        version = extractVersion(combined, detectionRule.versionPattern);
      }
    }

    if (rule.kind === 'functional-command' && result.exitCode !== 0) {
      return {
        toolId: entry.id,
        resolved: true,
        resolvedPath,
        versionOutput,
        version,
        meetsMinimumVersion: meetsMinimumVersion(version, entry.minimumVersion),
        functionalCheckPassed: false,
        architectureCompatible: architectureCompatible(entry, deps.architecture),
        needsRestart: false,
        verified: false,
        failureReason: `Functional check "${rule.executable} ${rule.args.join(' ')}" exited with code ${result.exitCode}.`,
      };
    }
  }

  const versionOk = meetsMinimumVersion(version, entry.minimumVersion);
  const archOk = architectureCompatible(entry, deps.architecture);
  const functionalOk = entry.verify.some((r) => r.kind === 'functional-command') ? true : null;

  const verified = !versionRuleFailed && versionOk !== false && archOk;

  return {
    toolId: entry.id,
    resolved: true,
    resolvedPath,
    versionOutput,
    version,
    meetsMinimumVersion: versionOk,
    functionalCheckPassed: functionalOk,
    architectureCompatible: archOk,
    needsRestart: false,
    verified,
    failureReason: verified
      ? null
      : versionRuleFailed
        ? 'Version output did not match the expected pattern.'
        : versionOk === false
          ? `Installed version ${version ?? 'unknown'} is below the minimum ${entry.minimumVersion ?? 'unknown'}.`
          : !archOk
            ? `Resolved executable is not compatible with architecture ${deps.architecture}.`
            : 'Verification failed for an unspecified reason.',
  };
}
