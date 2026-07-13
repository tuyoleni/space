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

// ---------------------------------------------------------------------------
// M6: GitHub (spec section 14, GH-001..009). Field sets are hand-declared
// here rather than imported from @space/github-engine — that package
// executes native operations and must never reach the renderer bundle
// (README's package-boundary rule) — so github-handlers.ts maps its
// engine-level types onto these narrower, renderer-safe ones.
// ---------------------------------------------------------------------------

export interface GithubAuthAccountSummary {
  readonly host: string;
  readonly account: string;
  readonly active: boolean;
  readonly scopes: readonly string[];
}

export interface GithubOrgSummary {
  readonly login: string;
  readonly id: number;
}

export interface GithubAuthReport {
  readonly cliInstalled: boolean;
  readonly cliVersion: string | null;
  readonly authenticated: boolean;
  readonly accounts: readonly GithubAuthAccountSummary[];
  readonly activeAccount: GithubAuthAccountSummary | null;
  readonly availableOrgs: readonly GithubOrgSummary[] | null;
  readonly gitProtocol: 'https' | 'ssh' | null;
  readonly tokenSourceStrategy: string;
}

export interface GithubAuthReportInput {
  readonly workspaceId: string;
  readonly host?: string;
}

export interface GithubAuthStartLoginInput {
  readonly workspaceId: string;
  readonly host?: string;
  readonly webFlow?: boolean;
}

export interface GithubAuthStartLoginResult {
  readonly sessionId: string;
}

export interface GithubAuthLogoutInput {
  readonly workspaceId: string;
  readonly host?: string;
}

export type GithubRepoVisibility = 'public' | 'private' | 'internal';

export interface GithubRepoPlanPublishInput {
  readonly workspaceId: string;
  readonly owner: string;
  readonly name: string;
  readonly host?: string;
}

export interface GithubRepoInfo {
  readonly owner: string;
  readonly name: string;
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly visibility: string;
}

export type GithubRepoPublishPlan = { readonly kind: 'create' } | { readonly kind: 'conflict'; readonly existing: GithubRepoInfo };

export interface GithubRepoPublishInput {
  readonly projectId: string;
  readonly owner: string;
  readonly name: string;
  readonly visibility: GithubRepoVisibility;
  readonly description?: string;
  readonly sourceFolder: string;
  readonly remoteName?: string;
  readonly push: boolean;
  /** Set only after the caller has already resolved a name conflict as "connect" — never used to silently overwrite (spec 14.5, 39). */
  readonly connect?: { readonly nameWithOwner: string; readonly url: string };
}

export interface GithubRepoPublishResult {
  readonly nameWithOwner: string;
  readonly url: string;
}

export type GithubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface GithubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly state: GithubPullRequestState;
  readonly isDraft: boolean;
  readonly labels: readonly string[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GithubPullRequestListInput {
  readonly workspaceId: string;
  readonly state?: 'open' | 'closed' | 'merged' | 'all';
  readonly limit?: number;
}

export interface GithubPullRequestCreateInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly head: string;
  readonly draft?: boolean;
  readonly reviewers?: readonly string[];
  readonly assignees?: readonly string[];
  readonly labels?: readonly string[];
}

export type GithubMergeMethod = 'merge' | 'squash' | 'rebase';

export interface GithubPullRequestMergeInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly method: GithubMergeMethod;
  readonly deleteBranch?: boolean;
  readonly confirmed: boolean;
}

export type GithubIssueState = 'OPEN' | 'CLOSED';

export interface GithubIssueSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly state: GithubIssueState;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GithubIssueListInput {
  readonly workspaceId: string;
  readonly state?: 'open' | 'closed' | 'all';
  readonly search?: string;
}

export interface GithubIssueCreateInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly body: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
}

export interface GithubCheckRun {
  readonly name: string;
  readonly state: string;
  readonly workflow: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly link: string;
  readonly bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';
}

export interface GithubChecksLoadInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly nameWithOwner: string;
  readonly branch: string;
}

export interface GithubChecksReport {
  readonly checks: readonly GithubCheckRun[];
  readonly complete: boolean;
  readonly required: { readonly requiredNames: readonly string[]; readonly missing: readonly string[]; readonly allRequiredPassing: boolean };
}

export interface GithubWorkflowRunSummary {
  readonly databaseId: number;
  readonly name: string;
  readonly displayTitle: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly workflowName: string;
  readonly headBranch: string;
  readonly event: string;
  readonly createdAt: string;
  readonly url: string;
}

export interface GithubActionsListRunsInput {
  readonly workspaceId: string;
  readonly workflow?: string;
  readonly branch?: string;
  readonly limit?: number;
}

export interface GithubReleaseCompareInput {
  readonly workspaceId: string;
  readonly nameWithOwner: string;
  readonly sinceTag: string;
  readonly head: string;
}

export interface GithubReleaseCompareSummary {
  readonly aheadBy: number;
  readonly totalCommits: number;
  readonly commitSubjects: readonly string[];
  readonly changedFiles: readonly string[];
}

// ---------------------------------------------------------------------------
// M6 (continued): the remainder of GH-001..009's surface — GH-002 credential
// setup, PR detail/edit/checkout, GH-006 Actions, the rest of GH-007 Issues,
// the rest of GH-008 Releases, and GH-009's pure offline gate. Wired to IPC
// so the whole github-handlers.ts surface is reachable, mirroring M5's
// git-handlers.ts coverage — GithubPanel.tsx's renderer controls remain a
// deliberately smaller slice on top (spec 36.6's minimal-first-slice
// pattern), same as GitPanel started before conflict handling followed.
// ---------------------------------------------------------------------------

export interface GithubSetupGitInput {
  readonly workspaceId: string;
  readonly remoteUrl: string;
  readonly host?: string;
}

export interface GithubSetupGitResult {
  readonly verified: boolean;
  readonly detail: string;
}

export interface GithubPullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface GithubPullRequestCommit {
  readonly oid: string;
  readonly messageHeadline: string;
  readonly authors: readonly string[];
}

export interface GithubPullRequestDetail extends GithubPullRequestSummary {
  readonly body: string;
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  readonly mergeStateStatus: string;
  readonly reviewRequests: readonly string[];
  readonly assignees: readonly string[];
  readonly files: readonly GithubPullRequestFile[];
  readonly commits: readonly GithubPullRequestCommit[];
  readonly closingIssuesNumbers: readonly number[];
}

export interface GithubPrViewInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly host?: string;
}

export interface GithubPullRequestEditInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly addReviewers?: readonly string[];
  readonly addAssignees?: readonly string[];
  readonly addLabels?: readonly string[];
  readonly host?: string;
}

export interface GithubPrCheckoutInput {
  readonly projectId: string;
  readonly number: number;
  readonly host?: string;
}

export interface GithubIssueDetail extends GithubIssueSummary {
  readonly body: string;
  readonly comments: readonly { readonly author: string; readonly body: string; readonly createdAt: string }[];
}

export interface GithubIssueViewInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly host?: string;
}

export interface GithubIssueEditInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly addLabels?: readonly string[];
  readonly removeLabels?: readonly string[];
  readonly addAssignees?: readonly string[];
  readonly removeAssignees?: readonly string[];
  readonly title?: string;
  readonly body?: string;
  readonly host?: string;
}

export interface GithubIssueCommentInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly body: string;
  readonly host?: string;
}

export type GithubIssueCloseReason = 'completed' | 'not planned';

export interface GithubIssueCloseInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly reason?: GithubIssueCloseReason;
  readonly host?: string;
}

export interface GithubIssueReopenInput {
  readonly workspaceId: string;
  readonly number: number;
  readonly host?: string;
}

export interface GithubIssueStartWorkInput {
  readonly projectId: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly baseBranch: string;
}

export interface GithubIssueStartWorkResult {
  readonly branchName: string;
  readonly prLinkFragment: string;
}

export interface GithubWorkflowSummary {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly state: string;
}

export interface GithubActionsListWorkflowsInput {
  readonly workspaceId: string;
  readonly host?: string;
}

export type GithubWorkflowDispatchInputType = 'string' | 'boolean' | 'choice' | 'environment' | 'number';

export interface GithubWorkflowDispatchInputDefinition {
  readonly name: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly default: string | null;
  readonly type: GithubWorkflowDispatchInputType;
  readonly options: readonly string[] | null;
}

export interface GithubActionsWorkflowInputsInput {
  readonly workspaceId: string;
  readonly nameWithOwner: string;
  readonly workflowPath: string;
  readonly ref?: string;
  readonly host?: string;
}

export interface GithubActionsTriggerInput {
  readonly workspaceId: string;
  readonly workflow: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly confirmed: boolean;
  readonly host?: string;
}

export interface GithubRunJob {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface GithubWorkflowRunDetail extends GithubWorkflowRunSummary {
  readonly jobs: readonly GithubRunJob[];
}

export interface GithubActionsViewRunInput {
  readonly workspaceId: string;
  readonly id: number;
  readonly host?: string;
}

export interface GithubActionsRunLogInput {
  readonly workspaceId: string;
  readonly id: number;
  readonly host?: string;
}

export interface GithubActionsDownloadArtifactsInput {
  readonly workspaceId: string;
  readonly id: number;
  readonly destinationDir: string;
  readonly artifactName?: string;
  readonly host?: string;
}

export interface GithubActionsCancelInput {
  readonly workspaceId: string;
  readonly id: number;
  readonly host?: string;
}

export interface GithubActionsRerunInput {
  readonly workspaceId: string;
  readonly id: number;
  readonly failedOnly: boolean;
  readonly host?: string;
}

export interface GithubReleaseSuggestVersionInput {
  readonly previousTag: string;
  readonly commitSubjects: readonly string[];
}

export interface GithubReleaseNotesInput {
  readonly workspaceId: string;
  readonly nameWithOwner: string;
  readonly tagName: string;
  readonly targetCommitish?: string;
  readonly host?: string;
}

export interface GithubReleaseCreateDraftInput {
  readonly projectId: string;
  readonly tagMessage: string;
  readonly tagName: string;
  readonly title: string;
  readonly notes: string;
  readonly target?: string;
  readonly prerelease?: boolean;
  readonly remoteName?: string;
}

export interface GithubReleasePublishInput {
  readonly workspaceId: string;
  readonly tagName: string;
  readonly confirmed: boolean;
  readonly host?: string;
}

export interface GithubReleaseTriggerWorkflowInput {
  readonly workspaceId: string;
  readonly workflow: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly confirmed: boolean;
  readonly host?: string;
}

export interface GithubReleaseUploadArtifactsInput {
  readonly workspaceId: string;
  readonly tagName: string;
  readonly filePaths: readonly string[];
  readonly host?: string;
}

export type GithubConnectivity = 'online' | 'degraded' | 'offline';

export interface GithubRemoteAvailabilityInput {
  readonly connectivity: GithubConnectivity;
}

export interface GithubRemoteActionAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

// ---------------------------------------------------------------------------
// M7: intent/agent layer (spec sections 13, 19). Evidence/intent-group/
// agent-action payloads are opaque `unknown` at this IPC boundary
// deliberately — they are produced and consumed entirely by
// @space/agent's own strict, tested schemas (ChangeIntentSchema,
// AgentActionSchema) inside agent-handlers.ts; this layer only validates
// the transport envelope, not domain semantics duplicated a second time.
// ---------------------------------------------------------------------------

export interface AgentDiffLoadInput {
  readonly projectId: string;
}

export interface AgentIntentGenerateInput {
  readonly evidence: readonly unknown[];
}

export interface AgentCommitComposeInput {
  readonly projectId: string;
  readonly evidence: readonly unknown[];
  readonly message: string;
}

export interface AgentCommitComposeResult {
  readonly sha: string;
  readonly hookOutput: string;
}

export interface AgentPlanDispatchInput {
  /** An untrusted, possibly model-produced AgentAction — validated by @space/agent's AgentActionSchema before anything acts on it. */
  readonly action: unknown;
  readonly confirmed: boolean;
}

export interface AgentPermissionGrantInput {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
}

export interface AgentPermissionRevokeInput {
  readonly id: string;
}

export interface AgentStandingPermissionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly actionType: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

// ---------------------------------------------------------------------------
// M8: automation (spec section 18). `trigger`/`conditions`/`actions` are
// opaque `unknown` at this IPC boundary deliberately, the same reasoning
// AgentPlanDispatchInput documents — they are produced and consumed by
// @space/automation's own strict, Zod-validated schemas
// (AutomationDefinitionSchema, AutomationActionSchema), not re-validated a
// second time here.
// ---------------------------------------------------------------------------

export interface AutomationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly trigger: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  readonly enabled: boolean;
  readonly lastExecutionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutomationCreateInput {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly trigger: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
}

export interface AutomationSetEnabledInput {
  readonly id: string;
  readonly enabled: boolean;
}

export interface AutomationRunSummary {
  readonly id: string;
  readonly automationId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly triggerType: string;
  readonly state: 'running' | 'succeeded' | 'failed' | 'skipped-disabled' | 'skipped-conditions';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly failureReason: string | null;
  readonly attempts: number;
}

export interface AutomationListRunsInput {
  readonly automationId: string;
  readonly limit?: number;
}

export interface AutomationSettingsGetInput {
  readonly workspaceId: string;
}

export interface AutomationSettingsSetInput {
  readonly workspaceId: string;
  readonly enabled: boolean;
}
