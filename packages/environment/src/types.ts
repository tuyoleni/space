/**
 * Shared types for the tool registry, non-mutating scan, bootstrap plans,
 * verification, and step orchestration (spec section 8, 16).
 *
 * Packages stay decoupled by convention in this repo (see
 * @space/workspace-runner's `ExecutableResolver`): every boundary this
 * package crosses (process execution, filesystem reads, OS info, storage)
 * is expressed as an injected port, never a hard dependency, so every
 * behaviour here is unit-testable with fakes and never shells out for
 * real in a test.
 */

export type SupportedPlatform = 'darwin' | 'win32';

// ---------------------------------------------------------------------------
// ONB-003: bootstrap manifest
// ---------------------------------------------------------------------------

export interface DetectionRule {
  /**
   * `command-on-path`: resolve `executable` via the platform's PATH lookup.
   * `version-command`: run `executable versionArgs` and extract a version
   * from stdout via `versionPattern` (first capture group).
   */
  readonly kind: 'command-on-path' | 'version-command';
  readonly executable: string;
  readonly versionArgs?: readonly string[];
  /** Regex source; first capture group is the version string. */
  readonly versionPattern?: string;
}

export type PackageManagerId = 'homebrew' | 'winget';

export interface InstallStrategy {
  readonly id: string;
  readonly platform: SupportedPlatform;
  readonly kind: 'package-manager' | 'official-installer' | 'volta-managed';
  readonly packageManagerId?: PackageManagerId;
  /** Package identity for the chosen package manager (spec 25.3.5 allow-list). */
  readonly packageId?: string;
  /** Executable id used to run this strategy (e.g. 'brew', 'winget', 'volta'). */
  readonly executable: string;
  readonly args: readonly string[];
  readonly requiresElevation: boolean;
  /**
   * True when the strategy may prompt the user interactively (password,
   * UAC, etc.) and Space MUST NOT hide or simulate that prompt (spec 8.4).
   */
  readonly interactive: boolean;
  /** Shown to the user before running (spec 8.4: "showing the official installer source"). */
  readonly sourceDescription: string;
  readonly officialSourceUrl: string;
}

export interface VerificationRule {
  readonly kind: 'version-output' | 'functional-command';
  readonly executable: string;
  readonly args: readonly string[];
  /** Regex source checked against stdout; required for 'version-output'. */
  readonly expectedPattern?: string;
}

export interface ToolManifestEntry {
  readonly id: string;
  readonly displayName: string;
  readonly required: boolean;
  readonly supportedPlatforms: readonly SupportedPlatform[];
  readonly architectures: readonly string[];
  readonly detection: readonly DetectionRule[];
  readonly installStrategies: readonly InstallStrategy[];
  readonly verify: readonly VerificationRule[];
  readonly minimumVersion?: string;
  readonly recommendedVersionPolicy: 'latest-supported' | 'lts' | 'pinned';
  readonly uninstallGuidance?: string;
}

export interface ToolManifest {
  readonly manifestVersion: string;
  readonly entries: readonly ToolManifestEntry[];
}

// ---------------------------------------------------------------------------
// ONB-002: non-mutating scan
// ---------------------------------------------------------------------------

export interface CommandExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command and captures output. Must never be given `shell: true` (spec 25.3.2). */
export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly timeoutMs?: number },
) => Promise<CommandExecutionResult>;

/** Resolves an executable name to an absolute path via PATH lookup, or null if absent. */
export type CommandOnPathResolver = (executable: string) => Promise<string | null>;

export interface FileSystemPort {
  exists(targetPath: string): Promise<boolean>;
  /** Non-destructive: must not create or leave behind any file it didn't already own. */
  canWrite(targetPath: string): Promise<boolean>;
  readTextFile(targetPath: string): Promise<string | null>;
}

export interface OsInfoPort {
  platform(): SupportedPlatform;
  architecture(): string;
  /** OS release/build version string. */
  release(): string;
  homeDir(): string;
  shellPath(): string | null;
  diskFreeBytes(targetPath: string): Promise<number | null>;
}

export interface ScanDependencies {
  readonly os: OsInfoPort;
  readonly resolveOnPath: CommandOnPathResolver;
  readonly runCommand: CommandRunner;
  readonly fs: FileSystemPort;
  readonly defaultProjectLocation: string;
}

export interface ScanToolResult {
  readonly toolId: string;
  readonly found: boolean;
  readonly path: string | null;
  readonly version: string | null;
  /** null when the tool wasn't found or the manifest entry has no minimum. */
  readonly meetsMinimumVersion: boolean | null;
}

export interface EditorDetectionResult {
  readonly id: string;
  readonly displayName: string;
  readonly found: boolean;
  readonly path: string | null;
}

export interface PackageManagerScanResult {
  readonly id: PackageManagerId;
  readonly found: boolean;
  readonly path: string | null;
  readonly version: string | null;
}

export interface ScanResult {
  readonly scannedAt: string;
  readonly platform: SupportedPlatform;
  readonly architecture: string;
  readonly osVersion: string;
  readonly diskFreeBytes: number | null;
  readonly shellAvailable: boolean;
  readonly shellPath: string | null;
  readonly packageManager: PackageManagerScanResult | null;
  readonly tools: readonly ScanToolResult[];
  readonly editors: readonly EditorDetectionResult[];
  readonly spaceShellIntegrationDetected: boolean;
  readonly defaultProjectLocation: string;
  readonly canWriteDefaultProjectLocation: boolean;
}

// ---------------------------------------------------------------------------
// ONB-004/005: bootstrap plan
// ---------------------------------------------------------------------------

export type PlannedStepKind =
  | 'prerequisite-check'
  | 'package-manager-install'
  | 'tool-install'
  | 'verify-only'
  | 'shell-integration';

export interface PlannedStep {
  readonly id: string;
  readonly sequence: number;
  readonly toolId: string | null;
  readonly kind: PlannedStepKind;
  readonly displayName: string;
  readonly humanExplanation: string;
  readonly strategy: InstallStrategy | null;
  readonly requiresElevation: boolean;
  readonly interactive: boolean;
  readonly changesMachineState: boolean;
  /**
   * Set when the step's real execution is intentionally out of scope for
   * this milestone (e.g. shell profile editing, owned by @space/terminal
   * in a later phase) — the plan still surfaces the step so onboarding UI
   * is honest about what's required, but the orchestrator must skip it
   * rather than silently no-op it.
   */
  readonly deferredImplementation: boolean;
}

export interface BootstrapPlan {
  readonly platform: SupportedPlatform;
  readonly createdAt: string;
  readonly blocked: boolean;
  readonly blockReason: string | null;
  readonly steps: readonly PlannedStep[];
}

// ---------------------------------------------------------------------------
// ONB-007: verification
// ---------------------------------------------------------------------------

export interface VerificationOutcome {
  readonly toolId: string;
  readonly resolved: boolean;
  readonly resolvedPath: string | null;
  readonly versionOutput: string | null;
  readonly version: string | null;
  readonly meetsMinimumVersion: boolean | null;
  readonly functionalCheckPassed: boolean | null;
  readonly architectureCompatible: boolean | null;
  readonly needsRestart: boolean;
  /** Overall verdict. Never derived from an installer's exit code (spec section 39). */
  readonly verified: boolean;
  readonly failureReason: string | null;
}

// ---------------------------------------------------------------------------
// ONB-006/008: installation progress, receipts and recovery
// ---------------------------------------------------------------------------

export type StepState =
  | 'pending'
  | 'running'
  | 'successful'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'needs_restart';

export type ReceiptOutcome =
  | 'installed_by_space'
  | 'already_present'
  | 'updated_by_space'
  | 'user_cancelled'
  | 'partially_installed'
  | 'needs_manual_remediation';

export interface StepExecutionRecord {
  readonly stepId: string;
  readonly toolId: string | null;
  readonly state: StepState;
  readonly humanExplanation: string;
  readonly commandDisplay: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly redactedOutput: string | null;
  readonly retryEligible: boolean;
  readonly changedMachineState: boolean;
  readonly outcome: ReceiptOutcome | null;
}

// ---------------------------------------------------------------------------
// ONB-001: first-run state
// ---------------------------------------------------------------------------

export type BootstrapStatus =
  | 'not_started'
  | 'scanning'
  | 'plan_ready'
  | 'installing'
  | 'verification_required'
  | 'partially_complete'
  | 'complete'
  | 'blocked';
