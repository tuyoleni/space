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
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
