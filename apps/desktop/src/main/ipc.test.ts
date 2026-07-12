/**
 * Verifies registerIpcHandlers wires every channel to sender validation
 * before anything else runs, routes to the right storage/terminal/
 * project-handlers call, wraps the native folder picker correctly, and
 * fans a terminal session's streamed events out to both storage
 * bookkeeping and the renderer's push-only terminal:event channel.
 * @space/security is left real (not mocked) so this also proves the
 * actual assertIpcSender integration, not just that some function was
 * called.
 */
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@space/contracts';
import type { GitHandlers } from './git-handlers';
import type { ProjectHandlers } from './project-handlers';
import type { StorageClient } from './storage-client';
import type { TerminalClient } from './terminal-client';
import type { TrustedSender } from '@space/security';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const showOpenDialog = vi.hoisted(() => vi.fn());
const fromWebContents = vi.hoisted(() => vi.fn());
const getAllWindows = vi.hoisted(() => vi.fn(() => [] as unknown[]));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog },
  BrowserWindow: { fromWebContents, getAllWindows },
}));

import { registerIpcHandlers } from './ipc';

const trusted: TrustedSender = { webContentsId: 1, allowedOriginPrefixes: ['file://'] };
const validEvent = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html' } };
const invalidEvent = { sender: { id: 999 }, senderFrame: { url: 'file:///index.html' } };

// Every channel this module is expected to register with ipcMain.handle.
// terminal:event is deliberately excluded — it's a push-only main -> renderer
// channel with no handle() counterpart.
const HANDLED_CHANNELS = Object.values(IPC_CHANNELS).filter((channel) => channel !== IPC_CHANNELS.terminalEvent);

function setup() {
  handlers.clear();
  showOpenDialog.mockReset();
  fromWebContents.mockReset();
  getAllWindows.mockReset().mockReturnValue([]);
  const storageCall = vi.fn();
  const storage = { call: storageCall } as unknown as StorageClient;
  const terminalCall = vi.fn();
  const terminalSubscribe = vi.fn();
  const terminal = { call: terminalCall, subscribe: terminalSubscribe } as unknown as TerminalClient;
  const projectHandlers = {
    detect: vi.fn(),
    detectPackageManager: vi.fn(),
    trustDecision: vi.fn(),
    listTemplates: vi.fn(),
    createFromTemplate: vi.fn(),
    clone: vi.fn(),
    installDependencies: vi.fn(),
    startDevServer: vi.fn(),
    stopDevServer: vi.fn(),
    listDevServers: vi.fn(),
  } as unknown as ProjectHandlers;
  const gitHandlers = {
    status: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    commit: vi.fn(),
    listBranches: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    deleteBranch: vi.fn(),
    loadHistory: vi.fn(),
    fetch: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    conflictState: vi.fn(),
    continueConflict: vi.fn(),
    abortConflict: vi.fn(),
  } as unknown as GitHandlers;
  registerIpcHandlers(trusted, storage, terminal, projectHandlers, gitHandlers);
  return { storageCall, terminalCall, terminalSubscribe, projectHandlers, gitHandlers };
}

function handlerFor(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`no handler registered for ${channel}`);
  }
  return handler;
}

describe('registerIpcHandlers', () => {
  it('registers exactly the documented handle-able channels', () => {
    setup();
    expect([...handlers.keys()].sort()).toEqual(HANDLED_CHANNELS.sort());
  });

  it.each([
    [IPC_CHANNELS.workspaceList, [], 'workspace.list', undefined],
    [IPC_CHANNELS.workspaceCreate, [{ name: 'A' }], 'workspace.create', { name: 'A' }],
    [IPC_CHANNELS.workspaceActivate, ['ws-1'], 'workspace.activate', { workspaceId: 'ws-1' }],
    [IPC_CHANNELS.projectList, ['ws-1'], 'project.list', { workspaceId: 'ws-1' }],
    [IPC_CHANNELS.projectInspectFolder, [{ path: '/a' }], 'project.inspectFolder', { path: '/a' }],
    [
      IPC_CHANNELS.projectAdd,
      [{ workspaceId: 'ws-1', canonicalPath: '/a' }],
      'project.add',
      { workspaceId: 'ws-1', canonicalPath: '/a' },
    ],
    [IPC_CHANNELS.terminalList, ['ws-1'], 'terminal.list', { workspaceId: 'ws-1' }],
  ] as const)('routes %s to storage.call(%s, ...) with a valid sender', async (channel, args, method, payload) => {
    const { storageCall } = setup();
    storageCall.mockResolvedValue('ok');
    const result = await handlerFor(channel)(validEvent, ...args);
    expect(storageCall).toHaveBeenCalledWith(method, payload);
    expect(result).toBe('ok');
  });

  it.each(Object.values(IPC_CHANNELS).filter((c) => c !== IPC_CHANNELS.terminalEvent))(
    'rejects %s for an untrusted sender before touching storage/terminal/project handlers',
    async (channel) => {
      const { storageCall, terminalCall, projectHandlers } = setup();
      await expect(handlerFor(channel)(invalidEvent)).rejects.toThrow('Rejected IPC call');
      expect(storageCall).not.toHaveBeenCalled();
      expect(terminalCall).not.toHaveBeenCalled();
      expect(projectHandlers.detect).not.toHaveBeenCalled();
    },
  );

  describe('project:pickFolder / project:pickParentDirectory', () => {
    it('returns the selected path when the user picks a folder', async () => {
      setup();
      fromWebContents.mockReturnValue({ id: 'fake-window' });
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/dev/app'] });
      expect(await handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent)).toBe('/Users/dev/app');
      expect(await handlerFor(IPC_CHANNELS.projectPickParentDirectory)(validEvent)).toBe('/Users/dev/app');
    });

    it('returns null when the user cancels', async () => {
      setup();
      fromWebContents.mockReturnValue({ id: 'fake-window' });
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      expect(await handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent)).toBeNull();
    });

    it('throws if the event has no associated window, without opening a dialog', async () => {
      setup();
      fromWebContents.mockReturnValue(null);
      await expect(handlerFor(IPC_CHANNELS.projectPickFolder)(validEvent)).rejects.toThrow('no associated window');
      expect(showOpenDialog).not.toHaveBeenCalled();
    });

    it('rejects for an untrusted sender without calling fromWebContents at all', async () => {
      setup();
      await expect(handlerFor(IPC_CHANNELS.projectPickFolder)(invalidEvent)).rejects.toThrow('Rejected IPC call');
      expect(fromWebContents).not.toHaveBeenCalled();
    });
  });

  describe('project:* routed to projectHandlers', () => {
    it.each([
      [IPC_CHANNELS.projectDetect, 'detect', { canonicalPath: '/a' }],
      [IPC_CHANNELS.projectDetectPackageManager, 'detectPackageManager', { canonicalPath: '/a' }],
      [IPC_CHANNELS.projectTrustDecision, 'trustDecision', { projectId: 'p-1', decision: 'trust-this-project' }],
      [IPC_CHANNELS.projectCreateFromTemplate, 'createFromTemplate', { workspaceId: 'ws-1' }],
      [IPC_CHANNELS.projectClone, 'clone', { workspaceId: 'ws-1' }],
      [IPC_CHANNELS.projectInstallDependencies, 'installDependencies', { projectId: 'p-1' }],
    ] as const)('routes %s to projectHandlers.%s', async (channel, method, input) => {
      const { projectHandlers } = setup();
      (projectHandlers[method] as ReturnType<typeof vi.fn>).mockResolvedValue('ok');
      const result = await handlerFor(channel)(validEvent, input);
      expect(projectHandlers[method]).toHaveBeenCalledWith(input);
      expect(result).toBe('ok');
    });

    it('projectListTemplates calls projectHandlers.listTemplates with no args', async () => {
      const { projectHandlers } = setup();
      (projectHandlers.listTemplates as ReturnType<typeof vi.fn>).mockReturnValue([]);
      await handlerFor(IPC_CHANNELS.projectListTemplates)(validEvent);
      expect(projectHandlers.listTemplates).toHaveBeenCalledWith();
    });
  });

  describe('devServer:* routed to projectHandlers', () => {
    it.each([
      [IPC_CHANNELS.devServerStart, 'startDevServer', { projectId: 'p-1' }],
      [IPC_CHANNELS.devServerStop, 'stopDevServer', { devProcessId: 'd-1' }],
    ] as const)('routes %s to projectHandlers.%s', async (channel, method, input) => {
      const { projectHandlers } = setup();
      (projectHandlers[method] as ReturnType<typeof vi.fn>).mockResolvedValue('ok');
      const result = await handlerFor(channel)(validEvent, input);
      expect(projectHandlers[method]).toHaveBeenCalledWith(input);
      expect(result).toBe('ok');
    });

    it('devServerList routes to projectHandlers.listDevServers', async () => {
      const { projectHandlers } = setup();
      (projectHandlers.listDevServers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await handlerFor(IPC_CHANNELS.devServerList)(validEvent, 'p-1');
      expect(projectHandlers.listDevServers).toHaveBeenCalledWith('p-1');
    });
  });

  describe('git:* routed to gitHandlers, through zod validation', () => {
    it.each([
      [IPC_CHANNELS.gitStatus, 'status', { projectId: 'p-1' }, { projectId: 'p-1' }],
      [IPC_CHANNELS.gitStage, 'stage', { projectId: 'p-1', paths: ['a.txt'] }, { projectId: 'p-1', paths: ['a.txt'] }],
      [IPC_CHANNELS.gitUnstage, 'unstage', { projectId: 'p-1', paths: ['a.txt'] }, { projectId: 'p-1', paths: ['a.txt'] }],
      [IPC_CHANNELS.gitCommit, 'commit', { projectId: 'p-1', message: 'fix' }, { projectId: 'p-1', message: 'fix' }],
      [IPC_CHANNELS.gitBranchList, 'listBranches', { projectId: 'p-1' }, { projectId: 'p-1' }],
      [
        IPC_CHANNELS.gitBranchCreate,
        'createBranch',
        { projectId: 'p-1', name: 'feature' },
        { projectId: 'p-1', name: 'feature' },
      ],
      [
        IPC_CHANNELS.gitBranchSwitch,
        'switchBranch',
        { projectId: 'p-1', name: 'main' },
        { projectId: 'p-1', name: 'main' },
      ],
      [
        IPC_CHANNELS.gitBranchDelete,
        'deleteBranch',
        { projectId: 'p-1', name: 'feature', force: true, confirmed: true },
        { projectId: 'p-1', name: 'feature', force: true, confirmed: true },
      ],
      [
        IPC_CHANNELS.gitHistoryLoad,
        'loadHistory',
        { projectId: 'p-1', offset: 0, count: 50 },
        { projectId: 'p-1', offset: 0, count: 50 },
      ],
      [IPC_CHANNELS.gitFetch, 'fetch', { projectId: 'p-1' }, { projectId: 'p-1' }],
      [IPC_CHANNELS.gitPull, 'pull', { projectId: 'p-1', mode: 'merge' }, { projectId: 'p-1', mode: 'merge' }],
      [
        IPC_CHANNELS.gitPush,
        'push',
        { projectId: 'p-1', branch: 'main' },
        { projectId: 'p-1', branch: 'main' },
      ],
      [IPC_CHANNELS.gitConflictState, 'conflictState', { projectId: 'p-1' }, { projectId: 'p-1' }],
      [IPC_CHANNELS.gitConflictContinue, 'continueConflict', { projectId: 'p-1' }, { projectId: 'p-1' }],
      [IPC_CHANNELS.gitConflictAbort, 'abortConflict', { projectId: 'p-1' }, { projectId: 'p-1' }],
    ] as const)('routes %s to gitHandlers.%s with the parsed input', async (channel, method, input, expected) => {
      const { gitHandlers } = setup();
      (gitHandlers[method] as ReturnType<typeof vi.fn>).mockResolvedValue('ok');
      const result = await handlerFor(channel)(validEvent, input);
      expect(gitHandlers[method]).toHaveBeenCalledWith(expected);
      expect(result).toBe('ok');
    });

    it('rejects a git:commit input that fails zod validation before reaching gitHandlers', async () => {
      const { gitHandlers } = setup();
      await expect(handlerFor(IPC_CHANNELS.gitCommit)(validEvent, { projectId: 'p-1', message: '' })).rejects.toThrow();
      expect(gitHandlers.commit).not.toHaveBeenCalled();
    });
  });

  describe('activity:listRange', () => {
    it('routes to storage.call with the parsed input', async () => {
      const { storageCall } = setup();
      storageCall.mockResolvedValue([]);
      const input = { workspaceId: 'ws-1', fromInclusive: '2026-01-01', toInclusive: '2026-01-31' };
      const result = await handlerFor(IPC_CHANNELS.activityListRange)(validEvent, input);
      expect(storageCall).toHaveBeenCalledWith('activity.listRange', input);
      expect(result).toEqual([]);
    });
  });

  describe('terminal:create', () => {
    it('records the session in storage and subscribes to fan out its stream', async () => {
      const { storageCall, terminalCall, terminalSubscribe } = setup();
      const session = {
        id: 'term-1',
        workspaceId: 'ws-1',
        projectId: null,
        shell: '/bin/zsh',
        cwd: '/tmp',
        pid: 999,
        state: 'running',
        startedAt: 't0',
        endedAt: null,
        exitCode: null,
        lastOutputAt: null,
      };
      terminalCall.mockResolvedValue(session);
      storageCall.mockResolvedValue(undefined);

      const result = await handlerFor(IPC_CHANNELS.terminalCreate)(validEvent, { workspaceId: 'ws-1', cols: 80, rows: 24 });

      expect(terminalCall).toHaveBeenCalledWith('terminal.create', { workspaceId: 'ws-1', cols: 80, rows: 24 });
      expect(storageCall).toHaveBeenCalledWith(
        'terminal.recordSession',
        expect.objectContaining({ id: 'term-1', pid: 999 }),
      );
      expect(terminalSubscribe).toHaveBeenCalledWith('term-1', expect.any(Function));
      expect(result).toEqual(session);
    });

    it('the subscribed listener persists output/exit to storage and pushes to the trusted window only', async () => {
      const { terminalCall, terminalSubscribe, storageCall } = setup();
      const send = vi.fn();
      getAllWindows.mockReturnValue([{ webContents: { id: 1, send } }, { webContents: { id: 2, send: vi.fn() } }]);
      terminalCall.mockResolvedValue({
        id: 'term-1',
        workspaceId: 'ws-1',
        projectId: null,
        shell: 'zsh',
        cwd: '/tmp',
        pid: 1,
        startedAt: 't0',
      });

      await handlerFor(IPC_CHANNELS.terminalCreate)(validEvent, { workspaceId: 'ws-1', cols: 80, rows: 24 });
      const listener = terminalSubscribe.mock.calls[0]?.[1] as (event: unknown) => void;

      listener({ kind: 'event', type: 'output', sessionId: 'term-1', chunk: 'hi', sequence: 1, timestamp: 't1' });
      expect(storageCall).toHaveBeenCalledWith('terminal.recordOutput', { sessionId: 'term-1', lastOutputAt: 't1' });
      expect(send).toHaveBeenCalledWith(
        IPC_CHANNELS.terminalEvent,
        expect.objectContaining({ type: 'output', sessionId: 'term-1', chunk: 'hi' }),
      );

      listener({ kind: 'event', type: 'exit', sessionId: 'term-1', exitCode: 0, signal: null, timestamp: 't2' });
      expect(storageCall).toHaveBeenCalledWith('terminal.markExited', { sessionId: 'term-1', exitCode: 0, endedAt: 't2' });
    });
  });
});
