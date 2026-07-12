// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

/**
 * Exposes exactly the SpaceAPI surface (spec section 22.2) via
 * contextBridge — no `ipcRenderer`, no broad file or shell primitives, and
 * no method that resembles `runCommand(command: string)`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type SpaceAPI } from '@space/contracts';

const spaceAPI: SpaceAPI = {
  workspace: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.workspaceCreate, input),
    activate: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceActivate, workspaceId),
  },
  project: {
    list: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.projectList, workspaceId),
    inspectFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectInspectFolder, input),
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.projectPickFolder),
    add: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectAdd, input),
  },
};

contextBridge.exposeInMainWorld('space', spaceAPI);
