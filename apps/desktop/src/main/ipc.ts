/**
 * Registers every renderer-facing IPC handler (spec section 22). A channel
 * that is not listed in IPC_CHANNELS cannot be registered here — this is
 * the full surface reachable from the renderer, and it resembles nothing
 * like `runCommand(command: string)`.
 *
 * M4 terminal handlers additionally wire the terminal worker's streamed
 * events to storage bookkeeping (last-output time, exit) and to the
 * renderer's push-only `terminal:event` channel, since a terminal session
 * is a stream, not a single request/response (spec 22.1).
 */
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type TerminalEvent } from '@space/contracts';
import { assertIpcSender, type TrustedSender } from '@space/security';
import type { ProjectHandlers } from './project-handlers';
import type { StorageClient } from './storage-client';
import type { TerminalClient } from './terminal-client';

function windowForEvent(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error('IPC event has no associated window');
  }
  return window;
}

function sendToTrustedWindow(trusted: TrustedSender, channel: string, payload: unknown): void {
  const window = BrowserWindow.getAllWindows().find((w) => w.webContents.id === trusted.webContentsId);
  window?.webContents.send(channel, payload);
}

async function pickDirectory(event: IpcMainInvokeEvent): Promise<string | null> {
  const window = windowForEvent(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
  const [selected] = result.filePaths;
  return result.canceled || !selected ? null : selected;
}

export function registerIpcHandlers(
  trusted: TrustedSender,
  storage: StorageClient,
  terminal: TerminalClient,
  projectHandlers: ProjectHandlers,
): void {
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
    return pickDirectory(event);
  });

  ipcMain.handle(IPC_CHANNELS.projectAdd, async (event, input) => {
    assertIpcSender(event, trusted);
    return storage.call('project.add', input);
  });

  // M4: project detection, trust, create/clone, install, dev servers.

  ipcMain.handle(IPC_CHANNELS.projectDetect, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.detect(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectDetectPackageManager, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.detectPackageManager(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectTrustDecision, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.trustDecision(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectListTemplates, async (event) => {
    assertIpcSender(event, trusted);
    return projectHandlers.listTemplates();
  });

  ipcMain.handle(IPC_CHANNELS.projectCreateFromTemplate, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.createFromTemplate(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectClone, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.clone(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectInstallDependencies, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.installDependencies(input);
  });

  ipcMain.handle(IPC_CHANNELS.projectPickParentDirectory, async (event) => {
    assertIpcSender(event, trusted);
    return pickDirectory(event);
  });

  // M4: terminal (TERM-001..006).

  ipcMain.handle(IPC_CHANNELS.terminalCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    const session = await terminal.call<{
      id: string;
      workspaceId: string;
      projectId: string | null;
      shell: string;
      cwd: string;
      pid: number;
      startedAt: string;
    }>('terminal.create', input);

    await storage.call('terminal.recordSession', {
      id: session.id,
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      shell: session.shell,
      cwd: session.cwd,
      pid: session.pid,
      startedAt: session.startedAt,
    });

    // Fan out this session's stream to storage bookkeeping and the renderer.
    terminal.subscribe(session.id, (workerEvent) => {
      if (workerEvent.type === 'output') {
        void storage.call('terminal.recordOutput', { sessionId: workerEvent.sessionId, lastOutputAt: workerEvent.timestamp });
      } else if (workerEvent.type === 'exit') {
        void storage.call('terminal.markExited', {
          sessionId: workerEvent.sessionId,
          exitCode: workerEvent.exitCode,
          endedAt: workerEvent.timestamp,
        });
      }
      const rendererEvent: TerminalEvent =
        workerEvent.type === 'output'
          ? { type: 'output', sessionId: workerEvent.sessionId, chunk: workerEvent.chunk, sequence: workerEvent.sequence, timestamp: workerEvent.timestamp }
          : workerEvent.type === 'exit'
            ? { type: 'exit', sessionId: workerEvent.sessionId, exitCode: workerEvent.exitCode, timestamp: workerEvent.timestamp }
            : { type: 'backpressure', sessionId: workerEvent.sessionId, droppedBytes: workerEvent.droppedBytes, timestamp: workerEvent.timestamp };
      sendToTrustedWindow(trusted, IPC_CHANNELS.terminalEvent, rendererEvent);
    });

    return session;
  });

  ipcMain.handle(IPC_CHANNELS.terminalWrite, async (event, input) => {
    assertIpcSender(event, trusted);
    return terminal.call('terminal.write', input);
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, async (event, input) => {
    assertIpcSender(event, trusted);
    return terminal.call('terminal.resize', input);
  });

  ipcMain.handle(IPC_CHANNELS.terminalDispose, async (event, input) => {
    assertIpcSender(event, trusted);
    return terminal.call('terminal.dispose', input);
  });

  ipcMain.handle(IPC_CHANNELS.terminalList, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    return storage.call('terminal.list', { workspaceId });
  });

  // M4: development server management (PRJ-006).

  ipcMain.handle(IPC_CHANNELS.devServerStart, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.startDevServer(input);
  });

  ipcMain.handle(IPC_CHANNELS.devServerStop, async (event, input) => {
    assertIpcSender(event, trusted);
    return projectHandlers.stopDevServer(input);
  });

  ipcMain.handle(IPC_CHANNELS.devServerList, async (event, projectId) => {
    assertIpcSender(event, trusted);
    return projectHandlers.listDevServers(projectId);
  });
}
