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
  AiApplyFixInput,
  AiApplyFixResult,
  AiGenerateCommitMessageInput,
  AiGenerateCommitMessageResult,
  AiKeyStatus,
  AiReviewCommentsInput,
  AiReviewCommentsResult,
  AiSetApiKeyInput,
  AutomationCreateInput,
  AutomationListRunsInput,
  AutomationRunSummary,
  AutomationSetEnabledInput,
  AutomationSettingsSetInput,
  AutomationSummary,
  BootstrapStatusResult,
  CloneProjectInput,
  ConnectedServiceDeployInput,
  ConnectedServiceDeployResult,
  ConnectedServiceLoginInput,
  ConnectedServiceLoginResult,
  ConnectedServicesResult,
  CreateProjectFromTemplateInput,
  CreateTerminalInput,
  CreateWorkspaceInput,
  DependencyScanInput,
  DependencyScanResult,
  DetectPackageManagerInput,
  DetectProjectInput,
  DevProcessInfo,
  EnvironmentExportReportInput,
  EnvironmentExportReportResult,
  EnvironmentScanInput,
  EnvironmentScanResult,
  EnvironmentToolActionInput,
  EnvironmentToolActionResult,
  PackageActionInput,
  PackageActionResult,
  PackageListInstalledResult,
  PackageSearchInput,
  PackageSearchResult,
  GitCommitInput,
  GitCommitResult,
  GitConflictResolveInput,
  GitConflictState,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitMergeBranchInput,
  GitDiffStats,
  GitFetchInput,
  GitFileDiffInput,
  GitFileDiffResult,
  GitHistoryLoadInput,
  GitHistoryPage,
  GitOperationOutcome,
  GitProjectInput,
  GitPullInput,
  GitPushInput,
  GitRefEntry,
  GitRemoteEntry,
  GitRemoteResult,
  GitStageInput,
  GitStashActionInput,
  GitStashEntry,
  GitStatusSummary,
  GitSwitchBranchInput,
  GitTagEntry,
  GitWorktreeEntry,
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
  MenuCommand,
  PackageManagerDetection,
  Project,
  ProjectDetectionReport,
  ProjectEnvironmentInfo,
  ProjectEnvironmentInfoInput,
  ProjectIconInput,
  ProjectIconResult,
  ProjectInspection,
  ProjectTemplateSummary,
  ProjectTrustDecisionInput,
  ServiceInfo,
  StartDevServerInput,
  StopDevServerInput,
  StopServiceInput,
  SystemProcessInfo,
  SystemStatsResult,
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
    /** Runs the package manager's semver-respecting update; same trust gate as install. */
    updateDependencies(input: InstallDependenciesInput): Promise<InstallDependenciesResult>;
    /** Real per-project runtime/package-manager/lockfile/scripts/env-var summary for the Environment screen's Project Environment panel. */
    environmentInfo(input: ProjectEnvironmentInfoInput): Promise<ProjectEnvironmentInfo>;
    /** Opens the native folder picker for a create/clone destination parent. */
    pickParentDirectory(): Promise<string | null>;
    /** M8: fires the `project-opened` automation trigger (spec 18.2) — call once when the user actually opens a project's working view, not on every list render. */
    opened(projectId: string): Promise<void>;
    /** Read-only: the project's own icon asset (shipped favicon/app icon) as a data URL, or null when it has none. */
    icon(input: ProjectIconInput): Promise<ProjectIconResult | null>;
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
  readonly services: {
    /** Merges dev servers, matched Docker/Podman containers, and processes running inside the project's terminals. */
    list(projectId: string): Promise<ServiceInfo[]>;
    /** Stops by kind: SIGTERM/SIGKILL for devServer + process, `docker`/`podman stop` for container. */
    stop(input: StopServiceInput): Promise<void>;
  };
  readonly git: {
    /** GIT-001: the authoritative status read (spec 11.4/11.12) — a watcher hint is never trusted on its own. */
    status(input: GitProjectInput): Promise<GitStatusSummary>;
    /** Real `git init` + stage-everything + one initial commit for a plain-folder project. Idempotent — a no-op if the project already has a repository. */
    initRepo(input: GitProjectInput): Promise<Project>;
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
    /** Merges `branch` into the current branch; `confirmed` is a structural gate (@space/domain). A resulting conflict surfaces the same way as any other in-progress operation — via `conflictState`/`continueConflict`/`abortConflict`. */
    mergeBranch(input: GitMergeBranchInput): Promise<GitOperationOutcome>;
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
    /** Real `git diff --numstat` for both halves (staged + unstaged) of the working tree. */
    diffStats(input: GitProjectInput): Promise<GitDiffStats>;
    /** Real unified patch text for one file on one side of the index. */
    diffFile(input: GitFileDiffInput): Promise<GitFileDiffResult>;
    /** Configured remotes with their fetch/push URLs (`git remote -v`). */
    listRemotes(input: GitProjectInput): Promise<readonly GitRemoteEntry[]>;
    /** Stash entries, newest first (`stash@{0}` at index 0); empty when the repo has no stashes. */
    listStashes(input: GitProjectInput): Promise<readonly GitStashEntry[]>;
    /** Non-destructive `git stash apply`: restores the entry but keeps it in the stash list. */
    applyStash(input: GitStashActionInput): Promise<GitOperationOutcome>;
    /** Destructive `git stash drop`; `confirmed` is a structural gate (@space/domain), not a UI-only check. */
    dropStash(input: GitStashActionInput): Promise<void>;
    /** Tags with their peeled target, subject, and tagged date (`git for-each-ref refs/tags`). */
    listTags(input: GitProjectInput): Promise<readonly GitTagEntry[]>;
    /** Linked working trees (`git worktree list`); `isCurrent` marks the one owning this project. */
    listWorktrees(input: GitProjectInput): Promise<readonly GitWorktreeEntry[]>;
    /** GIT-008: resolves one conflicted file by taking a whole side (`git checkout --ours|--theirs <path>`), then stages it. */
    resolveConflict(input: GitConflictResolveInput): Promise<void>;
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
  readonly ai: {
    /** Whether an Anthropic API key is configured (OS-backed safeStorage) — never returns the key itself. */
    keyStatus(): Promise<AiKeyStatus>;
    /** Encrypts and stores the key via Electron's safeStorage; overwrites any existing key. */
    setApiKey(input: AiSetApiKeyInput): Promise<void>;
    /** Scans the project for TODO/FIXME comments and asks Claude to propose a fix for each — read-only, never writes. */
    reviewComments(input: AiReviewCommentsInput): Promise<AiReviewCommentsResult>;
    /** Writes one proposed fix to disk — the renderer must have already confirmed with the user. */
    applyFix(input: AiApplyFixInput): Promise<AiApplyFixResult>;
    /** Generates a commit message from the staged/unstaged diff of exactly the given file paths. */
    generateCommitMessage(input: AiGenerateCommitMessageInput): Promise<AiGenerateCommitMessageResult>;
  };
  readonly bootstrap: {
    /** Reads the latest persisted bootstrap run (if any) and what to do next — never mutates. */
    getStatus(): Promise<BootstrapStatusResult>;
    /** Real machine scan + platform plan (ONB-002/004/005), persisted as a new run. No-ops if a plan already exists. */
    buildPlan(): Promise<BootstrapStatusResult>;
    /** Executes exactly one pending planned step (install + verify, ONB-006/007) and persists the result. Call in a loop from the renderer for live per-step progress. */
    runNextStep(): Promise<BootstrapStatusResult>;
    /** Marks the run cancelled (ONB-001 user_cancelled) — steps already run stay recorded. */
    cancel(): Promise<BootstrapStatusResult>;
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
  readonly environment: {
    /** Real, read-only machine scan (@space/environment's performScan) — toolchain versions, package manager (Homebrew/WinGet), disk space. Never installs or modifies anything. */
    scan(input?: EnvironmentScanInput): Promise<EnvironmentScanResult>;
    /** Runs the manifest's real install strategy for one tool — gated by `allowOnce` the same way project installs are. */
    installTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult>;
    /** Runs the manifest's real update strategy for one tool. */
    updateTool(input: EnvironmentToolActionInput): Promise<EnvironmentToolActionResult>;
    /** Writes the renderer's current scan (as displayed) to a file the user picks via the native save dialog. */
    exportReport(input: EnvironmentExportReportInput): Promise<EnvironmentExportReportResult>;
  };
  readonly connectedServices: {
    /** Real, read-only Docker/Vercel/Supabase/gcloud CLI presence + auth status — never a fabricated OAuth flow. */
    status(): Promise<ConnectedServicesResult>;
    /** Opens a real login PTY (`docker login`/`vercel login`/`supabase login`/`gcloud auth login`) — same mechanism as `gh auth login`. */
    startLogin(input: ConnectedServiceLoginInput): Promise<ConnectedServiceLoginResult>;
    /** Runs a real, non-interactive deploy (`vercel deploy --prod --yes`) in the project's directory — no terminal required. Only Vercel supports this today. */
    deploy(input: ConnectedServiceDeployInput): Promise<ConnectedServiceDeployResult>;
  };
  readonly packages: {
    /** Real, full inventory of every Homebrew formula/cask and global npm package actually installed on this machine (WinGet on win32). */
    listInstalled(): Promise<PackageListInstalledResult>;
    /** Real search across Homebrew (formula + cask) and the public npm registry — merged, one result list, regardless of source. */
    search(input: PackageSearchInput): Promise<PackageSearchResult>;
    install(input: PackageActionInput): Promise<PackageActionResult>;
    update(input: PackageActionInput): Promise<PackageActionResult>;
    uninstall(input: PackageActionInput): Promise<PackageActionResult>;
  };
  readonly menu: {
    /** Subscribe to native application-menu commands (main -> renderer). Mirrors terminal.subscribe's Unsubscribe shape. */
    onCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  };
  readonly system: {
    /** Real, on-demand CPU/memory/load sample (Node's os module) — no background polling loop the renderer didn't ask for. */
    stats(): Promise<SystemStatsResult>;
    /** Real top-CPU process list from `ps` (macOS); empty on platforms without a wired parser rather than fabricated. */
    processes(): Promise<readonly SystemProcessInfo[]>;
  };
  readonly dependencies: {
    /** Real `npm|pnpm audit --json` + `outdated --json` for one project's real package manager — read-only, never `audit fix`. Yarn reports `supported: false` with a reason instead of a guessed parse. */
    scan(input: DependencyScanInput): Promise<DependencyScanResult>;
  };
}
