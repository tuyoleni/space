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
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
