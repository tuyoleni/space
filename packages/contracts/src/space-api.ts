import type {
  ActivityEvent,
  ActivityListRangeInput,
  AddProjectInput,
  AgentCommitComposeInput,
  AgentCommitComposeResult,
  AgentDiffLoadInput,
  AgentIntentGenerateInput,
  AgentPermissionGrantInput,
  AgentPermissionRevokeInput,
  AgentPlanDispatchInput,
  AgentStandingPermissionSummary,
  AutomationCreateInput,
  AutomationListRunsInput,
  AutomationRunSummary,
  AutomationSetEnabledInput,
  AutomationSettingsSetInput,
  AutomationSummary,
  CloneProjectInput,
  CreateProjectFromTemplateInput,
  CreateTerminalInput,
  CreateWorkspaceInput,
  DetectPackageManagerInput,
  DetectProjectInput,
  DevProcessInfo,
  GitCommitInput,
  GitCommitResult,
  GitConflictState,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFetchInput,
  GitHistoryLoadInput,
  GitHistoryPage,
  GitOperationOutcome,
  GitProjectInput,
  GitPullInput,
  GitPushInput,
  GitRefEntry,
  GitRemoteResult,
  GitStageInput,
  GitStatusSummary,
  GitSwitchBranchInput,
  GithubActionsCancelInput,
  GithubActionsDownloadArtifactsInput,
  GithubActionsListRunsInput,
  GithubActionsListWorkflowsInput,
  GithubActionsRerunInput,
  GithubActionsRunLogInput,
  GithubActionsTriggerInput,
  GithubActionsViewRunInput,
  GithubActionsWorkflowInputsInput,
  GithubAuthLogoutInput,
  GithubAuthReport,
  GithubAuthReportInput,
  GithubAuthStartLoginInput,
  GithubAuthStartLoginResult,
  GithubChecksLoadInput,
  GithubChecksReport,
  GithubIssueCloseInput,
  GithubIssueCommentInput,
  GithubIssueCreateInput,
  GithubIssueDetail,
  GithubIssueEditInput,
  GithubIssueListInput,
  GithubIssueReopenInput,
  GithubIssueStartWorkInput,
  GithubIssueStartWorkResult,
  GithubIssueSummary,
  GithubIssueViewInput,
  GithubPrCheckoutInput,
  GithubPrViewInput,
  GithubPullRequestCreateInput,
  GithubPullRequestDetail,
  GithubPullRequestEditInput,
  GithubPullRequestListInput,
  GithubPullRequestMergeInput,
  GithubPullRequestSummary,
  GithubReleaseCompareInput,
  GithubReleaseCompareSummary,
  GithubReleaseCreateDraftInput,
  GithubReleaseNotesInput,
  GithubReleasePublishInput,
  GithubReleaseSuggestVersionInput,
  GithubReleaseTriggerWorkflowInput,
  GithubReleaseUploadArtifactsInput,
  GithubRemoteActionAvailability,
  GithubRemoteAvailabilityInput,
  GithubRepoPlanPublishInput,
  GithubRepoPublishInput,
  GithubRepoPublishPlan,
  GithubRepoPublishResult,
  GithubSetupGitInput,
  GithubSetupGitResult,
  GithubWorkflowDispatchInputDefinition,
  GithubWorkflowRunDetail,
  GithubWorkflowRunSummary,
  GithubWorkflowSummary,
  InspectFolderInput,
  InstallDependenciesInput,
  InstallDependenciesResult,
  PackageManagerDetection,
  Project,
  ProjectDetectionReport,
  ProjectInspection,
  ProjectTemplateSummary,
  ProjectTrustDecisionInput,
  StartDevServerInput,
  StopDevServerInput,
  TerminalDisposeInput,
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionInfo,
  TerminalWriteInput,
  Unsubscribe,
  Workspace,
  WorkspaceSummary,
} from './types';

/**
 * The full renderer-facing API surface (spec section 22.2). Nothing here
 * resembles `runCommand(command: string)`: every method is a narrow,
 * validated operation on a named domain. `terminal.subscribe` mirrors the
 * spec's `operation.subscribe(id, listener): Unsubscribe` shape (section
 * 22.2) because terminal output is a stream, not a single response.
 */
export interface SpaceAPI {
  readonly workspace: {
    list(): Promise<WorkspaceSummary[]>;
    create(input: CreateWorkspaceInput): Promise<Workspace>;
    activate(workspaceId: string): Promise<void>;
  };
  readonly project: {
    list(workspaceId: string): Promise<Project[]>;
    inspectFolder(input: InspectFolderInput): Promise<ProjectInspection>;
    /** Opens the native folder picker; returns null if the user cancels. */
    pickFolder(): Promise<string | null>;
    add(input: AddProjectInput): Promise<Project>;

    /** PRJ-002: read-only, confidence-scored detection facts. */
    detect(input: DetectProjectInput): Promise<ProjectDetectionReport>;
    /** PRJ-005: lockfile-based package manager resolution. */
    detectPackageManager(input: DetectPackageManagerInput): Promise<PackageManagerDetection>;
    /** PRJ-003/ADR-006: apply a trust decision (allow-once/trust-this-project/keep-untrusted). */
    trustDecision(input: ProjectTrustDecisionInput): Promise<Project>;
    /** PRJ-004: template metadata shown before any creation command runs. */
    listTemplates(): Promise<ProjectTemplateSummary[]>;
    createFromTemplate(input: CreateProjectFromTemplateInput): Promise<Project>;
    /** PRJ-001/004 clone flow, via @space/git-engine. */
    clone(input: CloneProjectInput): Promise<Project>;
    /** PRJ-005: gated by project trust unless `allowOnce` is set. */
    installDependencies(input: InstallDependenciesInput): Promise<InstallDependenciesResult>;
    /** Opens the native folder picker for a create/clone destination parent. */
    pickParentDirectory(): Promise<string | null>;
    /** M8: fires the `project-opened` automation trigger (spec 18.2) — call once when the user actually opens a project's working view, not on every list render. */
    opened(projectId: string): Promise<void>;
  };
  readonly terminal: {
    /** TERM-002: permanently binds the session to workspaceId/projectId at creation. */
    create(input: CreateTerminalInput): Promise<TerminalSessionInfo>;
    write(input: TerminalWriteInput): Promise<void>;
    resize(input: TerminalResizeInput): Promise<void>;
    dispose(input: TerminalDisposeInput): Promise<void>;
    list(workspaceId: string): Promise<TerminalSessionInfo[]>;
    /** Mirrors spec 22.2's operation.subscribe(id, listener): Unsubscribe. */
    subscribe(sessionId: string, listener: (event: TerminalEvent) => void): Unsubscribe;
  };
  readonly devServer: {
    /** PRJ-006: gated by project trust unless `allowOnce` is set; launched through the Workspace Process Runner. */
    start(input: StartDevServerInput): Promise<DevProcessInfo>;
    stop(input: StopDevServerInput): Promise<void>;
    list(projectId: string): Promise<DevProcessInfo[]>;
  };
  readonly git: {
    /** GIT-001: the authoritative status read (spec 11.4/11.12) — a watcher hint is never trusted on its own. */
    status(input: GitProjectInput): Promise<GitStatusSummary>;
    /** GIT-004 */
    stage(input: GitStageInput): Promise<void>;
    unstage(input: GitStageInput): Promise<void>;
    /** GIT-005: resolves identity, runs the real commit, verifies the resulting SHA. */
    commit(input: GitCommitInput): Promise<GitCommitResult>;
    /** GIT-006 */
    listBranches(input: GitProjectInput): Promise<GitRefEntry[]>;
    createBranch(input: GitCreateBranchInput): Promise<void>;
    switchBranch(input: GitSwitchBranchInput): Promise<void>;
    /** Destructive; `confirmed` is a structural gate (@space/domain), not a UI-only check. */
    deleteBranch(input: GitDeleteBranchInput): Promise<void>;
    /** GIT-002/12.5: paginated, cached history via HistoryStore. */
    loadHistory(input: GitHistoryLoadInput): Promise<GitHistoryPage>;
    /** GIT-007 */
    fetch(input: GitFetchInput): Promise<GitRemoteResult>;
    pull(input: GitPullInput): Promise<GitRemoteResult>;
    /** Force pushes require `confirmed`; raw --force additionally requires policy allowance server-side. */
    push(input: GitPushInput): Promise<GitRemoteResult>;
    /** GIT-008 */
    conflictState(input: GitProjectInput): Promise<GitConflictState>;
    continueConflict(input: GitProjectInput): Promise<GitOperationOutcome>;
    abortConflict(input: GitProjectInput): Promise<GitOperationOutcome>;
  };
  readonly activity: {
    /** ACT-002/003: raw events over a date range; the renderer aggregates into the grid/daily detail. */
    listRange(input: ActivityListRangeInput): Promise<ActivityEvent[]>;
  };
  readonly github: {
    /** GH-001: CLI/auth state, active account, orgs, git protocol, token-source strategy — never the token itself. */
    authReport(input: GithubAuthReportInput): Promise<GithubAuthReport>;
    /** Starts `gh auth login` in a real PTY; subscribe to the returned sessionId via `terminal.subscribe` for live output. */
    authStartLogin(input: GithubAuthStartLoginInput): Promise<GithubAuthStartLoginResult>;
    authLogout(input: GithubAuthLogoutInput): Promise<void>;
    /** GH-002: `gh auth setup-git`, verified with a non-destructive remote authentication check. */
    setupGit(input: GithubSetupGitInput): Promise<GithubSetupGitResult>;
    /** GH-003: always checked before publish; a conflict must be resolved explicitly (connect/rename/cancel), never silently overwritten. */
    repoPlanPublish(input: GithubRepoPlanPublishInput): Promise<GithubRepoPublishPlan>;
    repoPublish(input: GithubRepoPublishInput): Promise<GithubRepoPublishResult>;
    /** GH-004 */
    prList(input: GithubPullRequestListInput): Promise<GithubPullRequestSummary[]>;
    prView(input: GithubPrViewInput): Promise<GithubPullRequestDetail>;
    prCreate(input: GithubPullRequestCreateInput): Promise<{ readonly url: string }>;
    prEdit(input: GithubPullRequestEditInput): Promise<void>;
    /** Local, non-destructive branch switch — no confirmation gate needed (unlike merge). */
    prCheckout(input: GithubPrCheckoutInput): Promise<void>;
    /** Merge only with explicit confirmation — `confirmed` is a structural gate (@space/domain), not a UI-only check. */
    prMerge(input: GithubPullRequestMergeInput): Promise<void>;
    /** GH-007 */
    issueList(input: GithubIssueListInput): Promise<GithubIssueSummary[]>;
    issueView(input: GithubIssueViewInput): Promise<GithubIssueDetail>;
    issueCreate(input: GithubIssueCreateInput): Promise<{ readonly url: string }>;
    issueEdit(input: GithubIssueEditInput): Promise<void>;
    issueComment(input: GithubIssueCommentInput): Promise<void>;
    issueClose(input: GithubIssueCloseInput): Promise<void>;
    issueReopen(input: GithubIssueReopenInput): Promise<void>;
    /** Guided "start work": refreshes the base branch and creates a safe-slug branch for real; the caller navigates to the project. */
    issueStartWork(input: GithubIssueStartWorkInput): Promise<GithubIssueStartWorkResult>;
    /** GH-005 */
    checksLoad(input: GithubChecksLoadInput): Promise<GithubChecksReport>;
    /** GH-006. Watching a run/check to completion is deliberately not exposed over IPC — the underlying poll functions take a live `isCancelled` callback, which cannot cross a structured-clone IPC boundary; the renderer instead re-polls checksLoad/actionsViewRun on its own cadence. */
    actionsListWorkflows(input: GithubActionsListWorkflowsInput): Promise<GithubWorkflowSummary[]>;
    actionsListRuns(input: GithubActionsListRunsInput): Promise<GithubWorkflowRunSummary[]>;
    /** Real workflow_dispatch input metadata, read from the workflow file itself — Space must not invent inputs (spec 14.8). */
    actionsWorkflowInputs(input: GithubActionsWorkflowInputsInput): Promise<GithubWorkflowDispatchInputDefinition[]>;
    /** Treated as a high-impact remote action like merge/release-publish — `confirmed` is a structural gate (@space/domain). */
    actionsTrigger(input: GithubActionsTriggerInput): Promise<void>;
    actionsViewRun(input: GithubActionsViewRunInput): Promise<GithubWorkflowRunDetail>;
    actionsRunLog(input: GithubActionsRunLogInput): Promise<string>;
    /** `destinationDir` must already be picked by the caller (e.g. via `project.pickParentDirectory`). */
    actionsDownloadArtifacts(input: GithubActionsDownloadArtifactsInput): Promise<void>;
    actionsCancel(input: GithubActionsCancelInput): Promise<void>;
    actionsRerun(input: GithubActionsRerunInput): Promise<void>;
    /** GH-008 */
    releaseCompare(input: GithubReleaseCompareInput): Promise<GithubReleaseCompareSummary>;
    /** A conventional-commit-shaped suggestion only — never applied without the user confirming it becomes the actual tag. */
    releaseSuggestVersion(input: GithubReleaseSuggestVersionInput): Promise<string | null>;
    /** Generated notes are always editable before publish — this returns raw text, never auto-submits it. */
    releaseNotes(input: GithubReleaseNotesInput): Promise<string>;
    /** Creates the tag locally, pushes it, then creates the GitHub release as a draft — never already-published. */
    releaseCreateDraft(input: GithubReleaseCreateDraftInput): Promise<{ readonly url: string }>;
    /** Publishing is a high-impact remote action and requires confirmation (spec 14.10) — `confirmed` is a structural gate (@space/domain). */
    releasePublish(input: GithubReleasePublishInput): Promise<void>;
    releaseTriggerWorkflow(input: GithubReleaseTriggerWorkflowInput): Promise<void>;
    /** `filePaths` must already be picked by the caller — see `releasePickArtifactFiles`. */
    releaseUploadArtifacts(input: GithubReleaseUploadArtifactsInput): Promise<void>;
    /** Opens a native multi-file picker for release artifact upload; `null` when the user cancels. */
    releasePickArtifactFiles(): Promise<readonly string[] | null>;
    /** GH-009: pure gate, no I/O — local Git always stays available regardless of this result. */
    remoteAvailability(input: GithubRemoteAvailabilityInput): Promise<GithubRemoteActionAvailability>;
  };
  readonly agent: {
    /** CHG-001/002: real evidence (DiffSelection[]) from the project's actual staged+unstaged diff, and the always-available rule-based intent groups (ChangeIntent[]) built from it. Both are opaque here — see @space/agent for their real shape. */
    diffLoad(input: AgentDiffLoadInput): Promise<readonly unknown[]>;
    intentGenerate(input: AgentIntentGenerateInput): Promise<readonly unknown[]>;
    /** CHG-004: refreshes the diff, rejects stale selections, and commits through the same real GIT-005 commit path as a manual commit. */
    commitCompose(input: AgentCommitComposeInput): Promise<AgentCommitComposeResult>;
    /** spec 19.1/19.3: schema-validates `action` before anything acts on it, then routes it through the structural confirmation gate and the real M4-M6 capability it maps to. */
    planDispatch(input: AgentPlanDispatchInput): Promise<unknown>;
    /** spec 19.2.3: narrow, revocable standing permission — never usable for a destructive action's confirmation. */
    permissionGrant(input: AgentPermissionGrantInput): Promise<AgentStandingPermissionSummary>;
    permissionRevoke(input: AgentPermissionRevokeInput): Promise<void>;
    permissionList(workspaceId: string): Promise<readonly AgentStandingPermissionSummary[]>;
  };
  readonly automation: {
    /** spec 18.1: validated (workspaceId/project scope/trigger/conditions/ordered actions) before it is ever persisted. */
    create(input: AutomationCreateInput): Promise<AutomationSummary>;
    list(workspaceId: string): Promise<AutomationSummary[]>;
    /** spec 18.4: an individual automation's own enabled state — separate from the workspace-wide instant kill switch below. */
    setEnabled(input: AutomationSetEnabledInput): Promise<AutomationSummary>;
    delete(id: string): Promise<void>;
    /** spec 18.1's execution history / 18.4's "each run produces a receipt". */
    listRuns(input: AutomationListRunsInput): Promise<AutomationRunSummary[]>;
    /** spec 18.4: "a user can disable all automations immediately" — a real, instant, workspace-wide kill switch. */
    getAllEnabled(workspaceId: string): Promise<boolean>;
    setAllEnabled(input: AutomationSettingsSetInput): Promise<void>;
  };
  readonly appSettings: {
    /** spec 29.2: opt-in beta telemetry, default OFF, app-level (not per-workspace). */
    getTelemetryEnabled(): Promise<boolean>;
    setTelemetryEnabled(enabled: boolean): Promise<void>;
  };
}
