/**
 * Verifies registerIpcHandlers wires every channel to sender validation
 * before anything else runs, routes to the right storage method/payload,
 * and wraps the native folder picker correctly. @space/security is left
 * real (not mocked) so this also proves the actual assertIpcSender
 * integration, not just that some function was called.
 */
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@space/contracts';
import type { StorageClient } from './storage-client';
import type { TrustedSender } from '@space/security';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const showOpenDialog = vi.hoisted(() => vi.fn());
const fromWebContents = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog },
  BrowserWindow: { fromWebContents },
}));

import { registerIpcHandlers } from './ipc';

const trusted: TrustedSender = { webContentsId: 1, allowedOriginPrefixes: ['file://'] };
const validEvent = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html' } };
const invalidEvent = { sender: { id: 999 }, senderFrame: { url: 'file:///index.html' } };

function setup() {
  handlers.clear();
  showOpenDialog.mockReset();
  fromWebContents.mockReset();
  const call = vi.fn();
  const storage = { call } as unknown as StorageClient;
  registerIpcHandlers(trusted, storage);
  return { call };
}

function handlerFor(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`no handler registered for ${channel}`);
  }
  return handler;
}

describe('registerIpcHandlers', () => {
  it('registers exactly the six documented channels', () => {
    setup();
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC_CHANNELS).sort());
  });

  it.each([
    [IPC_CHANNELS.workspaceList, [], 'workspace.list', undefined],
    [IPC_CHANNELS.workspaceCreate, [{ name: 'A' }], 'workspace.create', { name: 'A' }],
    [IPC_CHANNELS.workspaceActivate, ['ws-1'], 'workspace.activate', { workspaceId: 'ws-1' }],
    [IPC_CHANNELS.projectList, ['ws-1'], 'project.list', { workspaceId: 'ws-1' }],
    [
      IPC_CHANNELS.projectInspectFolder,
      [{ path: '/a' }],
      'project.inspectFolder',
      { path: '/a' },
    ],
    [
      IPC_CHANNELS.projectAdd,
      [{ workspaceId: 'ws-1', canonicalPath: '/a' }],
      'project.add',
      { workspaceId: 'ws-1', canonicalPath: '/a' },
    ],
  ] as const)('routes %s to storage.call(%s, ...) with a valid sender', async (channel, args, method, payload) => {
    const { call } = setup();
    call.mockResolvedValue('ok');
    const result = await handlerFor(channel)(validEvent, ...args);
    expect(call).toHaveBeenCalledWith(method, payload);
    expect(result).toBe('ok');
  });

  it.each(Object.values(IPC_CHANNELS))(
    'rejects %s for an untrusted sender before touching storage',
    async (channel) => {
      const { call } = setup();
      await expect(handlerFor(channel)(invalidEvent)).rejects.toThrow('Rejected IPC call');
      expect(call).not.toHaveBeenCalled();
    },
  );

  describe('project:pickFolder', () => {
    it('returns the selected path when the user picks a folder', async () => {
      setup();
      fromWebContents.mockReturnValue({ id: 'fake-window' });
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/dev/app'] });
      const result = await handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent);
      expect(result).toBe('/Users/dev/app');
    });

    it('returns null when the user cancels', async () => {
      setup();
      fromWebContents.mockReturnValue({ id: 'fake-window' });
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      const result = await handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent);
      expect(result).toBeNull();
    });

    it('throws if the event has no associated window, without opening a dialog', async () => {
      setup();
      fromWebContents.mockReturnValue(null);
      await expect(handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent)).rejects.toThrow(
        'no associated window',
      );
      expect(showOpenDialog).not.toHaveBeenCalled();
    });

    it('rejects for an untrusted sender without calling fromWebContents at all', async () => {
      setup();
      await expect(handlerFor(IPC_CHANNELS.projectPickFolder)(invalidEvent)).rejects.toThrow(
        'Rejected IPC call',
      );
      expect(fromWebContents).not.toHaveBeenCalled();
    });
  });
});
