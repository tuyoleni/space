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

export interface ProjectIconInput {
  readonly canonicalPath: string;
}

export interface ProjectIconResult {
  /** The project's real icon asset (favicon/app icon) as a data URL. */
  readonly dataUrl: string;
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
// Environment scan — real machine toolchain/package-manager/disk report
// (@space/environment's performScan, read-only, spec section 8.2). Mirrors
// that package's ScanResult/ScanToolResult/PackageManagerScanResult shapes
// independently (same reason ProjectDetectionReport above does) rather than
// importing @space/environment, which touches node:child_process/fs and
// must never enter the renderer bundle (spec section 32).
// ---------------------------------------------------------------------------

export interface EnvironmentScanToolResult {
  readonly toolId: string;
  readonly displayName: string;
  readonly found: boolean;
  readonly path: string | null;
  readonly version: string | null;
  readonly meetsMinimumVersion: boolean | null;
  /** Human-readable install origin ("Homebrew", "Volta", "Bundled with Node", "System"), resolved from `path`/manifest — null when unresolved. */
  readonly source: string | null;
  /** Newest version this tool's install strategy can see (e.g. `brew info --json`, npm registry) — null when not looked up or the tool isn't found. */
  readonly latestVersion: string | null;
  /** True when `latestVersion` is newer than `version` — null when either side is unknown. */
  readonly updateAvailable: boolean | null;
}

export type EnvironmentPackageManagerId = 'homebrew' | 'winget';

export interface EnvironmentPackageManagerResult {
  readonly id: EnvironmentPackageManagerId;
  readonly found: boolean;
  readonly path: string | null;
  readonly version: string | null;
}

export interface EnvironmentScanResult {
  readonly scannedAt: string;
  readonly platform: 'darwin' | 'win32';
  readonly architecture: string;
  readonly osVersion: string;
  readonly diskFreeBytes: number | null;
  readonly shellAvailable: boolean;
  readonly shellPath: string | null;
  /** Basename of `shellPath` ("zsh", "bash") — null when the shell couldn't be resolved. */
  readonly shellName: string | null;
  /** Real `<shell> --version`/`--version` output, parsed — null when unavailable. */
  readonly shellVersion: string | null;
  readonly packageManager: EnvironmentPackageManagerResult | null;
  readonly tools: readonly EnvironmentScanToolResult[];
  readonly defaultProjectLocation: string;
  /** The real `git config --global user.name`, when set — used for the greeting, never guessed. */
  readonly gitUserName: string | null;
}

export interface EnvironmentScanInput {
  readonly defaultProjectLocation?: string;
}

export interface EnvironmentToolActionInput {
  readonly toolId: string;
  /** A one-time trust bypass for this single install/update action (mirrors PRJ-003 allow-once). */
  readonly allowOnce?: boolean;
}

export interface EnvironmentToolActionResult {
  readonly toolId: string;
  readonly succeeded: boolean;
  readonly exitCode: number | null;
  /** Real stderr/stdout tail on failure, or a short human summary on success — never fabricated. */
  readonly message: string | null;
}

export interface EnvironmentExportReportInput {
  /** The scan already held by the renderer — exported as-is, not re-fetched, so the file matches what's on screen. */
  readonly scan: EnvironmentScanResult;
  readonly connectedServices?: ConnectedServicesResult | null;
}

export interface EnvironmentExportReportResult {
  readonly saved: boolean;
  readonly filePath: string | null;
}

// ---------------------------------------------------------------------------
// Project environment — real per-project runtime/package-manager/lockfile/
// scripts/env-var summary shown on the Environment screen's "Project
// Environment" panel. Env var values are never read here, only names/count
// (spec 25.1 protected-asset discipline extends to display, not just exec).
// ---------------------------------------------------------------------------

export interface ProjectEnvironmentInfo {
  readonly projectId: string;
  readonly runtimeToolId: string;
  readonly runtimeVersion: string | null;
  /** "via Volta", "system", etc — null when the runtime itself wasn't found. */
  readonly runtimeSource: string | null;
  readonly packageManager: JsPackageManagerId | null;
  readonly lockfileDetected: boolean;
  readonly lockfileName: string | null;
  readonly scriptNames: readonly string[];
  /** Variable names only (from a real `.env`/`.env.local` file's keys) — values are never read. */
  readonly envVariableNames: readonly string[];
  readonly envFileName: string | null;
}

export interface ProjectEnvironmentInfoInput {
  readonly projectId: string;
}

// ---------------------------------------------------------------------------
// Connected services — real, read-only presence/auth checks for CLIs that
// are project-triggered rather than part of the bootstrap toolchain manifest
// (Docker, Vercel, Supabase, Google Cloud; GitHub is already covered by
// githubHandlers). "Connect" opens a real login PTY (same mechanism as
// `gh auth login`) — never a fabricated OAuth flow.
// ---------------------------------------------------------------------------

export type ConnectedServiceId = 'docker' | 'vercel' | 'supabase' | 'gcloud';

export interface ConnectedServiceStatus {
  readonly id: ConnectedServiceId;
  readonly displayName: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly connected: boolean;
  /** Account/org/context string when the CLI reports one (e.g. `vercel whoami`, `supabase projects list`) — null when not connected or unknown. */
  readonly account: string | null;
  /** Short status detail ("Docker Desktop", "Not running") — null when nothing more to say. */
  readonly detail: string | null;
  /** True when this service has a real, non-interactive `deploy()` (currently just Vercel) — drives whether the panel shows a Deploy button. */
  readonly deployable: boolean;
}

export interface ConnectedServicesResult {
  readonly scannedAt: string;
  readonly services: readonly ConnectedServiceStatus[];
}

export interface ConnectedServiceLoginInput {
  readonly workspaceId: string;
  readonly service: ConnectedServiceId;
}

export interface ConnectedServiceLoginResult {
  readonly sessionId: string;
}

export interface ConnectedServiceDeployInput {
  readonly projectId: string;
  readonly service: ConnectedServiceId;
}

export interface ConnectedServiceDeployResult {
  readonly success: boolean;
  /** The deployed URL, parsed from the CLI's own stdout — null when the deploy failed or none was printed. */
  readonly url: string | null;
  readonly output: string;
}

// ---------------------------------------------------------------------------
// Unified package manager — one real search/install/update/remove surface
// over every package source the machine actually has, instead of a fixed
// tool list: Homebrew formulae, Homebrew casks (real macOS apps), and
// global npm packages (WinGet on win32). Every entry here is either a real
// installed package (from `brew info --json=v2 --installed` / `npm list -g`)
// or a real search hit (from `brew search` / the public npm registry search
// API) — nothing in this list is invented, and `iconDataUrl` is either the
// real installed app's own icon or a real fetched favicon, never a stand-in.
// ---------------------------------------------------------------------------

export type PackageSource = 'homebrew-formula' | 'homebrew-cask' | 'npm-global' | 'winget';

export interface PackageEntry {
  /** `${source}:${name}` — stable across an install/search list refresh. */
  readonly id: string;
  readonly source: PackageSource;
  /** The real identifier used for install/update/uninstall commands (formula name, cask token, npm package name, winget id) — never a display-only label. */
  readonly name: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly homepage: string | null;
  /** null when not installed. */
  readonly installedVersion: string | null;
  /** Newest version this source's own real listing reports — null when unknown. */
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean | null;
  /** A real `data:` URL — the installed app's own icon, or a fetched favicon — never a placeholder. */
  readonly iconDataUrl: string | null;
}

export interface PackageListInstalledResult {
  readonly scannedAt: string;
  readonly packages: readonly PackageEntry[];
}

export interface PackageSearchInput {
  readonly query: string;
}

export interface PackageSearchResult {
  readonly query: string;
  readonly packages: readonly PackageEntry[];
}

export interface PackageActionInput {
  readonly source: PackageSource;
  readonly name: string;
}

export interface PackageActionResult {
  readonly source: PackageSource;
  readonly name: string;
  readonly succeeded: boolean;
  readonly exitCode: number | null;
  readonly message: string | null;
}

// ---------------------------------------------------------------------------
// Dependency vulnerability/outdated scan — real `npm audit`/`pnpm audit`
// and `npm outdated`/`pnpm outdated` output, parsed as-is. Yarn is
// reported as unsupported (with a reason) rather than guessed at.
// ---------------------------------------------------------------------------

export interface VulnerabilitySeverityCounts {
  readonly info: number;
  readonly low: number;
  readonly moderate: number;
  readonly high: number;
  readonly critical: number;
  readonly total: number;
}

/** One entry of the real `npm|pnpm outdated --json` output. */
export interface OutdatedPackageInfo {
  readonly name: string;
  readonly current: string | null;
  readonly wanted: string | null;
  readonly latest: string | null;
}

export interface DependencyScanResult {
  readonly scannedAt: string;
  readonly packageManager: JsPackageManagerId;
  readonly supported: boolean;
  readonly reason: string | null;
  readonly vulnerabilities: VulnerabilitySeverityCounts | null;
  readonly outdatedCount: number | null;
  readonly outdatedPackages: readonly OutdatedPackageInfo[] | null;
}

export interface DependencyScanInput {
  readonly canonicalPath: string;
  readonly packageManager: JsPackageManagerId;
}

// ---------------------------------------------------------------------------
// Live system resource stats (CPU/memory/load), read-only, sampled on demand
// from Node's os module — no fabricated data, no fixed refresh loop.
// ---------------------------------------------------------------------------

/** Native menu items that push a command to the renderer (see app-menu.ts). */
export type MenuCommand =
  | 'new-project'
  | 'add-folder'
  | 'clone'
  | 'new-terminal'
  | 'go-home'
  | 'go-changes'
  | 'go-history'
  | 'go-terminal'
  | 'go-environment'
  | 'git-fetch'
  | 'git-push';

export interface SystemStatsResult {
  readonly sampledAt: string;
  readonly cpuPercent: number;
  readonly cpuCount: number;
  readonly memoryTotalBytes: number;
  readonly memoryFreeBytes: number;
  readonly loadAverage: readonly [number, number, number];
  readonly processCount: number | null;
}

/** One row of the real `ps` output (top CPU consumers) — see system-handlers.ts. */
export interface SystemProcessInfo {
  readonly pid: number;
  readonly name: string;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  /** The process's real OS icon (its .app bundle icon on macOS) as a PNG data URL, or null for daemons/paths with no resolvable icon. */
  readonly iconDataUrl: string | null;
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
  /**
   * PRJ-004: "the UI MUST show the concrete framework, language, package
   * manager, and creation command before execution." Computed server-side
   * from the template's default option values so the renderer never has to
   * duplicate template logic just to render an accurate preview — this is
   * the literal command that will run (modulo the final directory name).
   */
  readonly previewCreationCommand: ProjectTemplateCommand;
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
// Home dashboard: unified running services (dev servers, containers,
// terminal-spawned processes) for a project.
// ---------------------------------------------------------------------------

export type ServiceKind = 'devServer' | 'container' | 'process';

export interface ServiceInfo {
  /** DevProcessInfo.id for devServer, container id for container, pid (stringified) for process. */
  readonly id: string;
  readonly projectId: string;
  readonly kind: ServiceKind;
  readonly label: string;
  readonly detail: string | null;
  readonly pid: number | null;
  readonly state: DevProcessState;
  readonly startedAt: string | null;
}

export interface StopServiceInput {
  readonly id: string;
  readonly kind: ServiceKind;
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

/** One file's real `git diff --numstat` counts; added/removed are null for binary files (git reports "-"). */
export interface GitFileDiffStat {
  readonly path: string;
  readonly added: number | null;
  readonly removed: number | null;
  readonly staged: boolean;
}

export interface GitDiffStats {
  readonly files: readonly GitFileDiffStat[];
}

export interface GitFileDiffInput {
  readonly projectId: string;
  readonly path: string;
  readonly staged: boolean;
}

export interface GitFileDiffResult {
  /** Raw unified patch text straight from `git diff` — empty when the file has no diff on that side. */
  readonly patchText: string;
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

export interface GitMergeBranchInput {
  readonly projectId: string;
  /** The branch to merge into the current branch — a shortname or a full `refs/heads/…`/`refs/remotes/…` ref. */
  readonly branch: string;
  /** `git merge --no-ff`: always create a merge commit, even when a fast-forward is possible. */
  readonly noFf?: boolean | undefined;
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

/** One configured remote and its fetch/push URLs (`git remote -v`). `pushUrl` equals `fetchUrl` unless a separate push URL is configured. */
export interface GitRemoteEntry {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl: string;
}

/** One stash entry. `index` 0 is the most recent (`stash@{0}`); `branch` is the branch the stash was created on when known; `createdAt` is unix epoch milliseconds. */
export interface GitStashEntry {
  readonly index: number;
  readonly message: string;
  readonly branch: string | null;
  readonly createdAt: number;
}

/** One tag ref. `targetSha` is the peeled commit (annotated tags are dereferenced); `subject`/`taggedAt` come from the tag object (annotated) or the target commit (lightweight); `taggedAt` is unix epoch milliseconds, null when unavailable. */
export interface GitTagEntry {
  readonly name: string;
  readonly targetSha: string;
  readonly subject: string | null;
  readonly taggedAt: number | null;
}

/** One linked working tree (`git worktree list`). `isMain` marks the primary worktree; `isCurrent` marks the one that owns the repo the request came from. */
export interface GitWorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly headSha: string;
  readonly isMain: boolean;
  readonly isCurrent: boolean;
}

/** Resolve one conflicted file by taking a whole side: `git checkout --ours|--theirs <path>` then stage it. */
export interface GitConflictResolveInput {
  readonly projectId: string;
  readonly path: string;
  readonly side: 'ours' | 'theirs';
}

/** Apply/drop targets the stash at `index` (`stash@{index}`). Destructive drops require `confirmed === true` (structural gate, @space/domain), like branch delete. */
export interface GitStashActionInput {
  readonly projectId: string;
  readonly index: number;
  readonly confirmed?: boolean;
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
  | 'branch-merged'
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
  /** Scopes which repo `gh` lists PRs from. Omit only when no project is in context (e.g. a workspace-level panel with nothing selected yet) — the result then reflects whatever repo the host process happens to be running in, which is rarely what the caller wants. */
  readonly projectId?: string;
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
  /** Scopes which repo `gh` lists issues from — see `GithubPullRequestListInput.projectId`. */
  readonly projectId?: string;
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
// AI comment review — real, on-demand Anthropic API calls (never a fabricated
// "AI" surface). The key is stored via Electron's OS-backed `safeStorage`,
// never in plain text; `reviewComments` only reads and proposes, it never
// writes — `applyFix` is a separate, explicitly confirmed step so the model
// never edits files on its own initiative.
// ---------------------------------------------------------------------------

export interface AiKeyStatus {
  readonly configured: boolean;
}

export interface AiSetApiKeyInput {
  readonly apiKey: string;
}

export interface AiReviewCommentsInput {
  readonly projectId: string;
}

export interface AiReviewFinding {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly comment: string;
  /** The exact, untrimmed line as read from disk — passed back to `applyFix` so it can detect the file changed since the review ran. */
  readonly originalLine: string;
  readonly proposedFix: string | null;
}

export interface AiReviewCommentsResult {
  readonly findings: readonly AiReviewFinding[];
  readonly scannedFileCount: number;
}

export interface AiApplyFixInput {
  readonly projectId: string;
  readonly file: string;
  readonly line: number;
  readonly originalLine: string;
  readonly newLine: string;
}

export interface AiApplyFixResult {
  readonly applied: boolean;
}

export interface AiGenerateCommitMessageInput {
  readonly projectId: string;
  /** Scopes the diff sent to the model to exactly the included change groups — never the whole repo's diff. */
  readonly filePaths: readonly string[];
}

export interface AiGenerateCommitMessageResult {
  readonly message: string;
}

// ---------------------------------------------------------------------------
// First-run bootstrap/onboarding (spec section 8, ONB-001..008). Mirrors
// @space/environment's BootstrapStatus/StepState/ReceiptOutcome and
// @space/storage's BootstrapRepository row shapes at the IPC boundary —
// neither package ever enters the renderer bundle directly (spec 32).
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

/** What the wizard should show/do next for the current status — mirrors @space/environment's resumeAction(). */
export type BootstrapResumeAction =
  | 'start_fresh'
  | 'restart_scan'
  | 'resume_plan'
  | 'resume_installing'
  | 'resume_verification'
  | 'show_partially_complete'
  | 'show_blocked'
  | 'show_complete';

export type BootstrapStepState = 'pending' | 'running' | 'successful' | 'skipped' | 'failed' | 'cancelled' | 'needs_restart';

export type BootstrapReceiptOutcome =
  | 'installed_by_space'
  | 'already_present'
  | 'updated_by_space'
  | 'user_cancelled'
  | 'partially_installed'
  | 'needs_manual_remediation';

export interface BootstrapStepSummary {
  readonly toolId: string | null;
  readonly displayName: string;
  readonly state: BootstrapStepState;
  readonly humanExplanation: string;
  readonly outcome: BootstrapReceiptOutcome | null;
}

export interface BootstrapStatusResult {
  readonly status: BootstrapStatus;
  readonly resumeAction: BootstrapResumeAction;
  readonly blockReason: string | null;
  readonly steps: readonly BootstrapStepSummary[];
  /** Index into `steps` the next `runNextStep()` call would execute — null when nothing is pending. */
  readonly nextStepIndex: number | null;
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
