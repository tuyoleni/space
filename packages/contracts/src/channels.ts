/**
 * IPC channel names, namespaced by domain (spec section 22.1). This is the
 * single source of truth for both the preload bridge and the main-process
 * handlers — a channel that isn't listed here cannot be registered or
 * invoked.
 */
export const IPC_CHANNELS = {
  workspaceList: 'workspace:list',
  workspaceCreate: 'workspace:create',
  workspaceActivate: 'workspace:activate',
  projectList: 'project:list',
  projectInspectFolder: 'project:inspectFolder',
  projectPickFolder: 'project:pickFolder',
  projectAdd: 'project:add',

  // M4
  projectDetect: 'project:detect',
  projectDetectPackageManager: 'project:detectPackageManager',
  projectTrustDecision: 'project:trustDecision',
  projectListTemplates: 'project:listTemplates',
  projectCreateFromTemplate: 'project:createFromTemplate',
  projectClone: 'project:clone',
  projectInstallDependencies: 'project:installDependencies',
  projectUpdateDependencies: 'project:updateDependencies',
  projectPickParentDirectory: 'project:pickParentDirectory',
  /** M8: fires the `project-opened` automation trigger (spec 18.2) — no other side effect. */
  projectOpened: 'project:opened',
  /** Read-only: resolves a project's real icon asset (favicon/app icon). */
  projectIcon: 'project:icon',

  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalDispose: 'terminal:dispose',
  terminalList: 'terminal:list',
  /** Push-only channel (main -> renderer); every payload carries its own sessionId to filter by. */
  terminalEvent: 'terminal:event',

  devServerStart: 'project:devServer:start',
  devServerStop: 'project:devServer:stop',
  devServerList: 'project:devServer:list',

  servicesList: 'project:services:list',
  servicesStop: 'project:services:stop',

  // M5: Git (GIT-001..009)
  gitStatus: 'git:status',
  gitInit: 'git:init',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitBranchList: 'git:branch:list',
  gitBranchCreate: 'git:branch:create',
  gitBranchSwitch: 'git:branch:switch',
  gitBranchDelete: 'git:branch:delete',
  gitBranchMerge: 'git:branch:merge',
  gitHistoryLoad: 'git:history:load',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitConflictState: 'git:conflict:state',
  gitConflictContinue: 'git:conflict:continue',
  gitConflictAbort: 'git:conflict:abort',
  gitDiffStats: 'git:diff:stats',
  gitDiffFile: 'git:diff:file',
  gitRemoteList: 'git:remote:list',
  gitStashList: 'git:stash:list',
  gitStashApply: 'git:stash:apply',
  gitStashDrop: 'git:stash:drop',
  gitTagList: 'git:tag:list',
  gitWorktreeList: 'git:worktree:list',
  gitConflictResolve: 'git:conflict:resolve',

  // M5: activity (spec section 17)
  activityListRange: 'activity:listRange',

  // M6: GitHub (spec section 14, GH-001..009)
  githubAuthReport: 'github:auth:report',
  githubAuthStartLogin: 'github:auth:startLogin',
  githubAuthLogout: 'github:auth:logout',
  githubSetupGit: 'github:setupGit',
  githubRepoPlanPublish: 'github:repo:planPublish',
  githubRepoPublish: 'github:repo:publish',
  githubPrList: 'github:pr:list',
  githubPrView: 'github:pr:view',
  githubPrCreate: 'github:pr:create',
  githubPrEdit: 'github:pr:edit',
  githubPrCheckout: 'github:pr:checkout',
  githubPrMerge: 'github:pr:merge',
  githubIssueList: 'github:issue:list',
  githubIssueView: 'github:issue:view',
  githubIssueCreate: 'github:issue:create',
  githubIssueEdit: 'github:issue:edit',
  githubIssueComment: 'github:issue:comment',
  githubIssueClose: 'github:issue:close',
  githubIssueReopen: 'github:issue:reopen',
  githubIssueStartWork: 'github:issue:startWork',
  githubChecksLoad: 'github:checks:load',
  githubActionsListWorkflows: 'github:actions:listWorkflows',
  githubActionsListRuns: 'github:actions:listRuns',
  githubActionsWorkflowInputs: 'github:actions:workflowInputs',
  githubActionsTrigger: 'github:actions:trigger',
  githubActionsViewRun: 'github:actions:viewRun',
  githubActionsRunLog: 'github:actions:runLog',
  githubActionsDownloadArtifacts: 'github:actions:downloadArtifacts',
  githubActionsCancel: 'github:actions:cancel',
  githubActionsRerun: 'github:actions:rerun',
  githubReleaseCompare: 'github:release:compare',
  githubReleaseSuggestVersion: 'github:release:suggestVersion',
  githubReleaseNotes: 'github:release:notes',
  githubReleaseCreateDraft: 'github:release:createDraft',
  githubReleasePublish: 'github:release:publish',
  githubReleaseTriggerWorkflow: 'github:release:triggerWorkflow',
  githubReleaseUploadArtifacts: 'github:release:uploadArtifacts',
  githubReleasePickArtifactFiles: 'github:release:pickArtifactFiles',
  githubRemoteAvailability: 'github:remoteAvailability',

  // M7: intent/agent layer (spec sections 13, 19)
  agentDiffLoad: 'agent:diff:load',
  agentIntentGenerate: 'agent:intent:generate',
  agentCommitCompose: 'agent:commit:compose',
  agentPlanDispatch: 'agent:plan:dispatch',
  agentPermissionGrant: 'agent:permission:grant',
  agentPermissionRevoke: 'agent:permission:revoke',
  agentPermissionList: 'agent:permission:list',

  // AI comment review — real Anthropic API calls, key stored via safeStorage
  aiKeyStatus: 'ai:key:status',
  aiSetApiKey: 'ai:key:set',
  aiReviewComments: 'ai:review:comments',
  aiApplyFix: 'ai:review:applyFix',
  aiGenerateCommitMessage: 'ai:generateCommitMessage',

  // First-run bootstrap/onboarding (spec section 8, ONB-001..008)
  bootstrapGetStatus: 'bootstrap:status',
  bootstrapBuildPlan: 'bootstrap:buildPlan',
  bootstrapRunNextStep: 'bootstrap:runNextStep',
  bootstrapCancel: 'bootstrap:cancel',

  // M8: automation (spec section 18)
  automationList: 'automation:list',
  automationCreate: 'automation:create',
  automationSetEnabled: 'automation:setEnabled',
  automationDelete: 'automation:delete',
  automationListRuns: 'automation:listRuns',
  automationSettingsGet: 'automation:settings:get',
  automationSettingsSet: 'automation:settings:set',

  // M8: app-level settings (spec 29.2 telemetry opt-in)
  appSettingsTelemetryGet: 'appSettings:telemetry:get',
  appSettingsTelemetrySet: 'appSettings:telemetry:set',

  // Real machine toolchain/package-manager/disk scan (@space/environment, read-only)
  environmentScan: 'environment:scan',
  // Real tool install/update (a manifest install/update strategy, gated the same way project installs are)
  environmentInstallTool: 'environment:installTool',
  environmentUpdateTool: 'environment:updateTool',
  // Writes the renderer's current scan (+ connected services) to a real file the user picks
  environmentExportReport: 'environment:exportReport',

  // Real per-project runtime/package-manager/lockfile/scripts/env-var summary
  projectEnvironmentInfo: 'project:environmentInfo',

  // Real, read-only Docker/Vercel/Supabase/gcloud presence+auth checks; startLogin opens a real login PTY
  connectedServicesStatus: 'connectedServices:status',
  connectedServicesStartLogin: 'connectedServices:startLogin',
  // Real, non-interactive deploy (currently Vercel only) — runs in the project's directory
  connectedServicesDeploy: 'connectedServices:deploy',

  // Unified package manager: real Homebrew (formula+cask)/npm-global/WinGet inventory, search, install/update/uninstall
  packagesListInstalled: 'packages:listInstalled',
  packagesSearch: 'packages:search',
  packagesInstall: 'packages:install',
  packagesUpdate: 'packages:update',
  packagesUninstall: 'packages:uninstall',

  /** Push-only channel (main -> renderer): native menu item was clicked; payload is a MenuCommand string. */
  menuCommand: 'menu:command',

  // Real live system resource stats (CPU/memory/load), read-only
  systemStats: 'system:stats',
  systemProcesses: 'system:processes',

  // Real dependency vulnerability/outdated scan (npm/pnpm audit+outdated), read-only
  dependencyScan: 'dependency:scan',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
