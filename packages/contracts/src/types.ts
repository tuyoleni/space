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

// ---------------------------------------------------------------------------
// M5: Git status, staging, commit, branches, history, remote, conflicts
// (GIT-001..009, spec sections 11-12). Shapes mirror @space/git-engine's
// status/refs/history/repository-state types field-for-field, but are
// declared independently rather than imported — @space/contracts stays
// free of any package that touches node:child_process (git-engine's
// node-git-executor.ts) so it never pulls main-process-only code into the
// renderer bundle, matching this file's existing convention of not
// depending on @space/storage's row types either.
// ---------------------------------------------------------------------------

export type GitFileStatusCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T';

export interface GitSubmoduleState {
  readonly isSubmodule: boolean;
  readonly commitChanged: boolean;
  readonly hasModifiedContent: boolean;
  readonly hasUntrackedContent: boolean;
}

export interface GitOrdinaryStatusEntry {
  readonly kind: 'ordinary';
  readonly path: string;
  readonly indexStatus: GitFileStatusCode;
  readonly worktreeStatus: GitFileStatusCode;
  readonly submodule: GitSubmoduleState;
}

export interface GitRenamedStatusEntry {
  readonly kind: 'renamed-or-copied';
  readonly path: string;
  readonly originalPath: string;
  readonly indexStatus: GitFileStatusCode;
  readonly worktreeStatus: GitFileStatusCode;
  readonly similarityScore: number;
  readonly submodule: GitSubmoduleState;
}

export interface GitUnmergedStatusEntry {
  readonly kind: 'unmerged';
  readonly path: string;
  readonly conflictCode: string;
  readonly submodule: GitSubmoduleState;
}

export interface GitUntrackedStatusEntry {
  readonly kind: 'untracked';
  readonly path: string;
}

export interface GitIgnoredStatusEntry {
  readonly kind: 'ignored';
  readonly path: string;
}

export type GitStatusEntry =
  | GitOrdinaryStatusEntry
  | GitRenamedStatusEntry
  | GitUnmergedStatusEntry
  | GitUntrackedStatusEntry
  | GitIgnoredStatusEntry;

export interface GitBranchInfo {
  /** null only for a brand-new repository with no commits yet. */
  readonly headCommit: string | null;
  readonly isInitial: boolean;
  /** null when HEAD is detached. */
  readonly branchName: string | null;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
}

export type GitOperationStateKind = 'none' | 'merge' | 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'bisect';

export interface GitOperationState {
  readonly kind: GitOperationStateKind;
  readonly interactive?: boolean;
  readonly sequencer?: boolean;
}

export interface GitStatusSummary {
  readonly branch: GitBranchInfo;
  readonly entries: readonly GitStatusEntry[];
  readonly operationState: GitOperationState;
  readonly conflictedFiles: readonly string[];
}

export interface GitProjectInput {
  readonly projectId: string;
}

export interface GitStageInput {
  readonly projectId: string;
  readonly paths: readonly string[];
}

export interface GitCommitInput {
  readonly projectId: string;
  readonly message: string;
}

export interface GitCommitResult {
  readonly sha: string;
  readonly hookOutput: string;
}

export type GitRefKind = 'local-branch' | 'remote-branch' | 'tag';

export interface GitRefEntry {
  readonly refname: string;
  readonly kind: GitRefKind;
  readonly shortName: string;
  readonly sha: string;
  readonly peeledSha: string | null;
  readonly isHead: boolean;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly upstreamGone: boolean;
  readonly subject: string;
}

export interface GitCreateBranchInput {
  readonly projectId: string;
  readonly name: string;
  readonly fromCommit?: string | undefined;
}

export interface GitSwitchBranchInput {
  readonly projectId: string;
  readonly name: string;
}

export interface GitDeleteBranchInput {
  readonly projectId: string;
  readonly name: string;
  readonly force: boolean;
  readonly confirmed: boolean;
}

export interface GitHistoryLoadInput {
  readonly projectId: string;
  readonly offset: number;
  readonly count: number;
}

export interface GitCommitRef {
  readonly name: string;
  readonly kind: 'local-branch' | 'remote-branch' | 'tag' | 'HEAD';
}

export interface GitCommitNode {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly body?: string;
  readonly authorName: string;
  readonly authorEmail?: string;
  readonly authoredAt: number;
  readonly committedAt: number;
  readonly refs: readonly GitCommitRef[];
}

export interface GitHistoryPage {
  readonly commits: readonly GitCommitNode[];
  readonly totalIndexed: number;
  readonly fullyIndexed: boolean;
}

export interface GitFetchInput {
  readonly projectId: string;
  readonly remoteName?: string | undefined;
}

export type GitPullMode = 'merge' | 'rebase';

export interface GitPullInput {
  readonly projectId: string;
  readonly mode: GitPullMode;
  readonly remoteName?: string | undefined;
  readonly branch?: string | undefined;
}

export type GitForceMode = 'none' | 'with-lease' | 'raw';

export interface GitPushInput {
  readonly projectId: string;
  readonly branch: string;
  readonly remoteName?: string | undefined;
  readonly setUpstream?: boolean | undefined;
  readonly force?: GitForceMode | undefined;
  readonly confirmed?: boolean | undefined;
}

export interface GitRemoteResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitConflictState {
  readonly inConflict: boolean;
  readonly operationState: GitOperationState;
  readonly conflictedFiles: readonly string[];
}

export interface GitOperationOutcome {
  readonly completed: boolean;
  readonly remaining: GitOperationState;
  readonly stdout: string;
  readonly stderr: string;
}

// ---------------------------------------------------------------------------
// M5: activity (spec section 17, ACT-001..004)
// ---------------------------------------------------------------------------

export type ActivityEventType =
  | 'workspace-created'
  | 'workspace-switched'
  | 'project-added'
  | 'project-created'
  | 'project-cloned'
  | 'project-removed'
  | 'tool-installed'
  | 'tool-verified'
  | 'terminal-session'
  | 'dev-server-started'
  | 'dev-server-stopped'
  | 'git-initialised'
  | 'commit'
  | 'branch-created'
  | 'branch-switched'
  | 'branch-deleted'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'pull-request'
  | 'check-or-workflow'
  | 'release-or-deployment'
  | 'automation-execution';

export interface ActivityEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly eventType: ActivityEventType;
  readonly occurredAt: string;
  readonly subjectRef: string | null;
  readonly summary: string;
  readonly weight: number;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface ActivityListRangeInput {
  readonly workspaceId: string;
  readonly fromInclusive: string;
  readonly toInclusive: string;
}
