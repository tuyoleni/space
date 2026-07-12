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
  projectPickParentDirectory: 'project:pickParentDirectory',

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

  // M5: Git (GIT-001..009)
  gitStatus: 'git:status',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitBranchList: 'git:branch:list',
  gitBranchCreate: 'git:branch:create',
  gitBranchSwitch: 'git:branch:switch',
  gitBranchDelete: 'git:branch:delete',
  gitHistoryLoad: 'git:history:load',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitConflictState: 'git:conflict:state',
  gitConflictContinue: 'git:conflict:continue',
  gitConflictAbort: 'git:conflict:abort',

  // M5: activity (spec section 17)
  activityListRange: 'activity:listRange',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
