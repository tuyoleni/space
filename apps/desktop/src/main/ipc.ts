/**
 * Registers every renderer-facing IPC handler (spec section 22). A channel
 * that is not listed in IPC_CHANNELS cannot be registered here — this is
 * the full surface reachable from the renderer, and it resembles nothing
 * like `runCommand(command: string)`.
 */
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@space/contracts';
import { assertIpcSender, type TrustedSender } from '@space/security';
import type { StorageClient } from './storage-client';

function windowForEvent(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error('IPC event has no associated window');
  }
  return window;
}

export function registerIpcHandlers(trusted: TrustedSender, storage: StorageClient): void {
  ipcMain.handle(IPC_CHANNELS.workspaceList, async (event) => {
    assertIpcSender(event, trusted);
    return storage.call('workspace.list', undefined);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    return storage.call('workspace.create', input);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceActivate, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    return storage.call('workspace.activate', { workspaceId });
  });

  ipcMain.handle(IPC_CHANNELS.projectList, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    return storage.call('project.list', { workspaceId });
  });

  ipcMain.handle(IPC_CHANNELS.projectInspectFolder, async (event, input) => {
    assertIpcSender(event, trusted);
    return storage.call('project.inspectFolder', input);
  });

  ipcMain.handle(IPC_CHANNELS.projectPickFolder, async (event) => {
    assertIpcSender(event, trusted);
    const window = windowForEvent(event);
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    const [selected] = result.filePaths;
    return result.canceled || !selected ? null : selected;
  });

  ipcMain.handle(IPC_CHANNELS.projectAdd, async (event, input) => {
    assertIpcSender(event, trusted);
    return storage.call('project.add', input);
  });
}
