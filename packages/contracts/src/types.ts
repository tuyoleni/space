/**
 * Shared domain types for the IPC contract (spec section 22, entities in
 * section 23.2). Field sets mirror the persisted columns exactly so the
 * renderer never sees data the storage layer cannot actually produce.
 */

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly iconToken: string | null;
  readonly active: boolean;
}

export interface Workspace extends WorkspaceSummary {
  readonly defaultProjectDirectory: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly iconToken?: string;
  readonly defaultProjectDirectory?: string;
}

export type ProjectTrustState = 'untrusted' | 'trusted';

export interface Project {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly canonicalPath: string;
  readonly filesystemIdentity: string | null;
  readonly repositoryRoot: string | null;
  readonly trustState: ProjectTrustState;
  readonly detectedTypes: readonly string[];
  readonly lastOpenedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddProjectInput {
  readonly workspaceId: string;
  readonly canonicalPath: string;
  /** Defaults to the path's base name when omitted. */
  readonly name?: string;
}

export interface InspectFolderInput {
  readonly path: string;
}

/**
 * Deliberately minimal: full confidence-scored detection (PRJ-002) is a
 * Phase 3 deliverable. This only answers what registration needs to know.
 */
export interface ProjectInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isGitRepository: boolean;
  readonly alreadyRegisteredInWorkspaceId: string | null;
}

// ---------------------------------------------------------------------------
// M4: project detection (PRJ-002)
// ---------------------------------------------------------------------------

export type DetectionCategory =
  | 'vcs'
  | 'runtime'
  | 'package-manager'
  | 'framework'
  | 'language'
  | 'env-file'
  | 'generated-directory';

export interface DetectionFact {
  readonly category: DetectionCategory;
  readonly id: string;
  readonly label: string;
  readonly confidence: number;
  readonly evidence: string;
}

export interface ProjectDetectionReport {
  readonly canonicalPath: string;
  readonly detectedAt: string;
  readonly facts: readonly DetectionFact[];
}

export interface DetectProjectInput {
  readonly canonicalPath: string;
}

// ---------------------------------------------------------------------------
// M4: package manager detection (PRJ-005)
// ---------------------------------------------------------------------------

export type JsPackageManagerId = 'npm' | 'yarn' | 'pnpm';

export interface LockfileMatch {
  readonly file: string;
  readonly packageManager: JsPackageManagerId;
}

export type PackageManagerResolution = 'single' | 'none' | 'conflict';

export interface PackageManagerDetection {
  readonly canonicalPath: string;
  readonly lockfilesFound: readonly LockfileMatch[];
  readonly resolution: PackageManagerResolution;
  readonly packageManager: JsPackageManagerId | null;
}

export interface DetectPackageManagerInput {
  readonly canonicalPath: string;
}

export interface InstallDependenciesInput {
  readonly projectId: string;
  /** Required when detection reports a 'conflict' or 'none' — Space must not guess (PRJ-005). */
  readonly packageManager?: JsPackageManagerId;
  /** A one-time trust bypass for this single install (PRJ-003 allow-once). */
  readonly allowOnce?: boolean;
}

export interface InstallDependenciesResult {
  readonly packageManager: JsPackageManagerId;
  readonly succeeded: boolean;
  readonly exitCode: number | null;
}

// ---------------------------------------------------------------------------
// M4: project trust (PRJ-003, ADR-006)
// ---------------------------------------------------------------------------

export type TrustDecision = 'allow-once' | 'trust-this-project' | 'keep-untrusted';

export interface ProjectTrustDecisionInput {
  readonly projectId: string;
  readonly decision: TrustDecision;
}

// ---------------------------------------------------------------------------
// M4: create/clone flows (PRJ-001, PRJ-004)
// ---------------------------------------------------------------------------

export interface ProjectTemplateOption {
  readonly id: string;
  readonly label: string;
  readonly kind: 'string' | 'boolean' | 'choice';
  readonly choices?: readonly string[];
  readonly defaultValue: string | boolean;
}

export interface ProjectTemplateCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface ProjectTemplateSummary {
  readonly id: string;
  readonly displayName: string;
  readonly supportedPlatforms: readonly ('darwin' | 'win32')[];
  readonly requiredExecutables: readonly string[];
  readonly userEditableOptions: readonly ProjectTemplateOption[];
  readonly expectedFiles: readonly string[];
  readonly verifyCommand: ProjectTemplateCommand;
  readonly devCommand: ProjectTemplateCommand | null;
  readonly defaultIgnoreRules: readonly string[];
}

export interface CreateProjectFromTemplateInput {
  readonly workspaceId: string;
  readonly templateId: string;
  /** Directory that will contain the new project directory (must already exist). */
  readonly destinationParentDirectory: string;
  /** Also used as the new project directory's name. */
  readonly name: string;
  readonly options?: Readonly<Record<string, string | boolean>>;
}

export interface CloneProjectInput {
  readonly workspaceId: string;
  readonly remoteUrl: string;
  /** Directory that will contain the cloned project directory (must already exist). */
  readonly destinationParentDirectory: string;
  /** Also used as the destination directory's name; defaults to the remote's basename. */
  readonly name?: string;
  readonly branch?: string;
}

// ---------------------------------------------------------------------------
// M4: terminal (TERM-001..006)
// ---------------------------------------------------------------------------

export type TerminalSessionState = 'running' | 'exited';

export interface TerminalSessionInfo {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number;
  readonly state: TerminalSessionState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly lastOutputAt: string | null;
}

export interface CreateTerminalInput {
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalWriteInput {
  readonly sessionId: string;
  readonly data: string;
}

export interface TerminalResizeInput {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalDisposeInput {
  readonly sessionId: string;
}

export type TerminalEvent =
  | { readonly type: 'output'; readonly sessionId: string; readonly chunk: string; readonly sequence: number; readonly timestamp: string }
  | { readonly type: 'exit'; readonly sessionId: string; readonly exitCode: number | null; readonly timestamp: string }
  | { readonly type: 'backpressure'; readonly sessionId: string; readonly droppedBytes: number; readonly timestamp: string };

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// M4: development process management (PRJ-006)
// ---------------------------------------------------------------------------

export type DevProcessState = 'running' | 'stopped' | 'crashed';

export interface DevProcessInfo {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandDisplay: string;
  readonly pid: number | null;
  readonly state: DevProcessState;
  readonly detectedUrl: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
}

export interface StartDevServerInput {
  readonly projectId: string;
  readonly allowOnce?: boolean;
}

export interface StopDevServerInput {
  readonly devProcessId: string;
}
