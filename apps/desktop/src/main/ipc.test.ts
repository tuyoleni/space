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
import type { AgentHandlers } from './agent-handlers';
import type { AutomationHandlers } from './automation-handlers';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
import type { ProjectHandlers } from './project-handlers';
import type { StorageClient } from './storage-client';
import type { TerminalClient } from './terminal-client';
import type { TrustedSender } from '@space/security';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const showOpenDialog = vi.hoisted(() => vi.fn());
const fromWebContents = vi.hoisted(() => vi.fn());
const getAllWindows = vi.hoisted(() => vi.fn(() => [] as unknown[]));
const getPath = vi.hoisted(() => vi.fn(() => '/home/test'));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog },
  BrowserWindow: { fromWebContents, getAllWindows },
  app: { getPath },
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
  const githubHandlers = {
    authReport: vi.fn(),
    startAuthLogin: vi.fn().mockResolvedValue({ sessionId: 'gh-session-1' }),
    logout: vi.fn(),
    setupGit: vi.fn(),
    planPublish: vi.fn(),
    publishRepository: vi.fn(),
    prList: vi.fn(),
    prView: vi.fn(),
    prCreate: vi.fn(),
    prEdit: vi.fn(),
    prCheckout: vi.fn(),
    prMerge: vi.fn(),
    issuesList: vi.fn(),
    issuesView: vi.fn(),
    issuesCreate: vi.fn(),
    issuesEdit: vi.fn(),
    issuesComment: vi.fn(),
    issuesClose: vi.fn(),
    issuesReopen: vi.fn(),
    issuesStartWork: vi.fn(),
    prChecks: vi.fn(),
    actionsListWorkflows: vi.fn(),
    actionsListRuns: vi.fn(),
    actionsWorkflowInputs: vi.fn(),
    actionsTrigger: vi.fn(),
    actionsViewRun: vi.fn(),
    actionsRunLog: vi.fn(),
    actionsDownloadArtifacts: vi.fn(),
    actionsCancel: vi.fn(),
    actionsRerun: vi.fn(),
    releaseCompare: vi.fn(),
    releaseSuggestVersion: vi.fn(),
    releaseNotes: vi.fn(),
    releaseCreateDraft: vi.fn(),
    releasePublish: vi.fn(),
    releaseTriggerWorkflow: vi.fn(),
    releaseUploadArtifactFiles: vi.fn(),
    remoteAvailability: vi.fn(),
  } as unknown as GithubHandlers;
  const agentHandlers = {
    loadEvidence: vi.fn(),
    generateIntentGroups: vi.fn(),
    generateIntentGroupsWithModel: vi.fn(),
    composeCommit: vi.fn(),
    dispatchPlan: vi.fn(),
    grantPermission: vi.fn(),
    revokePermission: vi.fn(),
    listPermissions: vi.fn(),
    computeIntrinsicRisk: vi.fn(),
  } as unknown as AgentHandlers;
  const automationHandlers = {
    createAutomation: vi.fn(),
    listAutomations: vi.fn(),
    setEnabled: vi.fn(),
    deleteAutomation: vi.fn(),
    getAllEnabled: vi.fn(),
    setAllEnabled: vi.fn(),
    listRuns: vi.fn(),
    handleTriggerEvent: vi.fn().mockResolvedValue([]),
  } as unknown as AutomationHandlers;
  registerIpcHandlers(trusted, storage, terminal, projectHandlers, gitHandlers, githubHandlers, agentHandlers, automationHandlers);
  return { storageCall, terminalCall, terminalSubscribe, projectHandlers, gitHandlers, githubHandlers, agentHandlers, automationHandlers };
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

  describe('M7: agent channels route to agentHandlers with a valid sender', () => {
    it('agent:diff:load routes to loadEvidence', async () => {
      const { agentHandlers } = setup();
      (agentHandlers.loadEvidence as ReturnType<typeof vi.fn>).mockResolvedValue(['evidence']);
      const result = await handlerFor(IPC_CHANNELS.agentDiffLoad)(validEvent, { projectId: 'proj-1' });
      expect(agentHandlers.loadEvidence).toHaveBeenCalledWith({ projectId: 'proj-1' });
      expect(result).toEqual(['evidence']);
    });

    it('agent:plan:dispatch routes to dispatchPlan with the raw action and confirmed flag', async () => {
      const { agentHandlers } = setup();
      (agentHandlers.dispatchPlan as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      const action = { id: 'a1', type: 'git.stage' };
      const result = await handlerFor(IPC_CHANNELS.agentPlanDispatch)(validEvent, { action, confirmed: true });
      expect(agentHandlers.dispatchPlan).toHaveBeenCalledWith({ rawAction: action, confirmed: true });
      expect(result).toEqual({ ok: true });
    });

    it('agent:permission:grant routes to grantPermission', async () => {
      const { agentHandlers } = setup();
      const input = { workspaceId: 'ws-1', projectId: null, actionType: 'github.createPullRequest' };
      await handlerFor(IPC_CHANNELS.agentPermissionGrant)(validEvent, input);
      expect(agentHandlers.grantPermission).toHaveBeenCalledWith(input);
    });

    it('agent:permission:list routes to listPermissions', async () => {
      const { agentHandlers } = setup();
      await handlerFor(IPC_CHANNELS.agentPermissionList)(validEvent, 'ws-1');
      expect(agentHandlers.listPermissions).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('M8: automation channels route to automationHandlers with a valid sender', () => {
    it('automation:create routes to createAutomation with the parsed definition', async () => {
      const { automationHandlers } = setup();
      const input = { workspaceId: 'ws-1', projectId: null, name: 'Notify on failure', trigger: { type: 'check-failed' }, conditions: [], actions: [{ id: '1', type: 'notifyUser', parameters: { message: 'x' } }] };
      (automationHandlers.createAutomation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'auto-1' });
      const result = await handlerFor(IPC_CHANNELS.automationCreate)(validEvent, input);
      expect(automationHandlers.createAutomation).toHaveBeenCalledWith(input);
      expect(result).toEqual({ id: 'auto-1' });
    });

    it('automation:list routes to listAutomations', async () => {
      const { automationHandlers } = setup();
      await handlerFor(IPC_CHANNELS.automationList)(validEvent, 'ws-1');
      expect(automationHandlers.listAutomations).toHaveBeenCalledWith('ws-1');
    });

    it('automation:setEnabled routes to setEnabled', async () => {
      const { automationHandlers } = setup();
      await handlerFor(IPC_CHANNELS.automationSetEnabled)(validEvent, { id: 'auto-1', enabled: false });
      expect(automationHandlers.setEnabled).toHaveBeenCalledWith('auto-1', false);
    });

    it('automation:settings:set routes to the instant kill switch', async () => {
      const { automationHandlers } = setup();
      await handlerFor(IPC_CHANNELS.automationSettingsSet)(validEvent, { workspaceId: 'ws-1', enabled: false });
      expect(automationHandlers.setAllEnabled).toHaveBeenCalledWith('ws-1', false);
    });

    it('git:commit fires a commit-created automation trigger after a successful commit, scoped to the project\'s workspace', async () => {
      const { gitHandlers, storageCall, automationHandlers } = setup();
      (gitHandlers.commit as ReturnType<typeof vi.fn>).mockResolvedValue({ sha: 'abc123', hookOutput: '' });
      storageCall.mockResolvedValue({ workspaceId: 'ws-1' });
      await handlerFor(IPC_CHANNELS.gitCommit)(validEvent, { projectId: 'p-1', message: 'fix' });
      // Automation trigger handling is fire-and-forget — flush microtasks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(automationHandlers.handleTriggerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'commit-created', workspaceId: 'ws-1', projectId: 'p-1', context: { sha: 'abc123' } }),
      );
    });

    it('project:opened fires a project-opened automation trigger scoped to the project\'s workspace', async () => {
      const { storageCall, automationHandlers } = setup();
      storageCall.mockResolvedValue({ workspaceId: 'ws-1' });
      await handlerFor(IPC_CHANNELS.projectOpened)(validEvent, { projectId: 'p-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(automationHandlers.handleTriggerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'project-opened', workspaceId: 'ws-1', projectId: 'p-1' }),
      );
    });

    it('project:opened does nothing when the project no longer exists', async () => {
      const { storageCall, automationHandlers } = setup();
      storageCall.mockResolvedValue(null);
      await handlerFor(IPC_CHANNELS.projectOpened)(validEvent, { projectId: 'gone' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(automationHandlers.handleTriggerEvent).not.toHaveBeenCalled();
    });
  });

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

  describe('github:* routed to githubHandlers, through zod validation', () => {
    it('githubAuthReport routes to authReport(workspaceId, host)', async () => {
      const { githubHandlers } = setup();
      (githubHandlers.authReport as ReturnType<typeof vi.fn>).mockResolvedValue({ cliInstalled: true });
      const result = await handlerFor(IPC_CHANNELS.githubAuthReport)(validEvent, { workspaceId: 'ws-1', host: 'github.com' });
      expect(githubHandlers.authReport).toHaveBeenCalledWith('ws-1', 'github.com');
      expect(result).toEqual({ cliInstalled: true });
    });

    it('githubAuthStartLogin routes to startAuthLogin with a resolved cwd, and subscribes to fan out the PTY stream', async () => {
      const { githubHandlers, terminalSubscribe } = setup();
      const result = await handlerFor(IPC_CHANNELS.githubAuthStartLogin)(validEvent, { workspaceId: 'ws-1' });
      expect(githubHandlers.startAuthLogin).toHaveBeenCalledWith({ workspaceId: 'ws-1', cwd: '/home/test' });
      expect(terminalSubscribe).toHaveBeenCalledWith('gh-session-1', expect.any(Function));
      expect(result).toEqual({ sessionId: 'gh-session-1' });
    });

    it('githubAuthStartLogin fans PTY output out to the trusted window only', async () => {
      const { terminalSubscribe } = setup();
      const send = vi.fn();
      getAllWindows.mockReturnValue([{ webContents: { id: 1, send } }, { webContents: { id: 2, send: vi.fn() } }]);
      await handlerFor(IPC_CHANNELS.githubAuthStartLogin)(validEvent, { workspaceId: 'ws-1' });
      const listener = terminalSubscribe.mock.calls[0]?.[1] as (event: unknown) => void;
      listener({ kind: 'event', type: 'output', sessionId: 'gh-session-1', chunk: 'Open https://github.com/login/device', sequence: 1, timestamp: 't1' });
      expect(send).toHaveBeenCalledWith(IPC_CHANNELS.terminalEvent, expect.objectContaining({ type: 'output', sessionId: 'gh-session-1' }));
    });

    it('githubAuthLogout routes to logout(workspaceId, host)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubAuthLogout)(validEvent, { workspaceId: 'ws-1' });
      expect(githubHandlers.logout).toHaveBeenCalledWith('ws-1', undefined);
    });

    it('githubRepoPlanPublish routes to planPublish(workspaceId, owner, name, host)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubRepoPlanPublish)(validEvent, { workspaceId: 'ws-1', owner: 'acme', name: 'widgets' });
      expect(githubHandlers.planPublish).toHaveBeenCalledWith('ws-1', 'acme', 'widgets', undefined);
    });

    it('githubRepoPublish routes to publishRepository with a mapped input, never inventing a connect resolution', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubRepoPublish)(validEvent, {
        projectId: 'p-1',
        owner: 'acme',
        name: 'widgets',
        visibility: 'public',
        sourceFolder: '/proj',
        push: true,
      });
      expect(githubHandlers.publishRepository).toHaveBeenCalledWith(
        'p-1',
        { owner: 'acme', name: 'widgets', visibility: 'public', sourceFolder: '/proj', push: true },
        undefined,
      );
    });

    it('githubPrList routes to prList with the parsed filter', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrList)(validEvent, { workspaceId: 'ws-1', state: 'open' });
      expect(githubHandlers.prList).toHaveBeenCalledWith('ws-1', { state: 'open' });
    });

    it('githubPrCreate routes to prCreate with the parsed input', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrCreate)(validEvent, { workspaceId: 'ws-1', title: 't', body: 'b', base: 'main', head: 'feature' });
      expect(githubHandlers.prCreate).toHaveBeenCalledWith('ws-1', { title: 't', body: 'b', base: 'main', head: 'feature' });
    });

    it('githubPrCreate forwards reviewers/assignees/labels when present (spec 14.6)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrCreate)(validEvent, {
        workspaceId: 'ws-1',
        title: 't',
        body: 'b',
        base: 'main',
        head: 'feature',
        reviewers: ['octocat'],
        assignees: ['octocat'],
        labels: ['bug'],
      });
      expect(githubHandlers.prCreate).toHaveBeenCalledWith('ws-1', {
        title: 't',
        body: 'b',
        base: 'main',
        head: 'feature',
        reviewers: ['octocat'],
        assignees: ['octocat'],
        labels: ['bug'],
      });
    });

    it('githubPrMerge rejects an unconfirmed merge before it ever reaches githubHandlers', async () => {
      const { githubHandlers } = setup();
      await expect(
        handlerFor(IPC_CHANNELS.githubPrMerge)(validEvent, { workspaceId: 'ws-1', number: 42, method: 'squash' }),
      ).rejects.toThrow();
      expect(githubHandlers.prMerge).not.toHaveBeenCalled();
    });

    it('githubPrMerge routes to prMerge once confirmed:true is present', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrMerge)(validEvent, { workspaceId: 'ws-1', number: 42, method: 'squash', confirmed: true });
      expect(githubHandlers.prMerge).toHaveBeenCalledWith('ws-1', 42, 'squash', false, true);
    });

    it('githubIssueList / githubIssueCreate route to issuesList/issuesCreate', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubIssueList)(validEvent, { workspaceId: 'ws-1' });
      expect(githubHandlers.issuesList).toHaveBeenCalledWith('ws-1', {});
      await handlerFor(IPC_CHANNELS.githubIssueCreate)(validEvent, { workspaceId: 'ws-1', title: 't', body: 'b' });
      expect(githubHandlers.issuesCreate).toHaveBeenCalledWith('ws-1', { title: 't', body: 'b' });
    });

    it('githubIssueCreate forwards labels/assignees when present (spec 14.9)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubIssueCreate)(validEvent, { workspaceId: 'ws-1', title: 't', body: 'b', labels: ['bug'], assignees: ['octocat'] });
      expect(githubHandlers.issuesCreate).toHaveBeenCalledWith('ws-1', { title: 't', body: 'b', labels: ['bug'], assignees: ['octocat'] });
    });

    it('githubChecksLoad routes to prChecks with the parsed input', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubChecksLoad)(validEvent, { workspaceId: 'ws-1', number: 42, nameWithOwner: 'acme/widgets', branch: 'main' });
      expect(githubHandlers.prChecks).toHaveBeenCalledWith('ws-1', 42, 'acme/widgets', 'main');
    });

    it('githubActionsListRuns routes to actionsListRuns with the parsed filter', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubActionsListRuns)(validEvent, { workspaceId: 'ws-1', workflow: 'release.yml' });
      expect(githubHandlers.actionsListRuns).toHaveBeenCalledWith('ws-1', { workflow: 'release.yml' });
    });

    it('githubReleaseCompare routes to releaseCompare with the parsed input', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubReleaseCompare)(validEvent, { workspaceId: 'ws-1', nameWithOwner: 'acme/widgets', sinceTag: 'v1.0.0', head: 'main' });
      expect(githubHandlers.releaseCompare).toHaveBeenCalledWith('ws-1', 'acme/widgets', 'v1.0.0', 'main');
    });
  });

  describe('github:* (continued): the rest of GH-001..009 routed to githubHandlers', () => {
    it('githubSetupGit routes to setupGit(workspaceId, remoteUrl, host)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubSetupGit)(validEvent, { workspaceId: 'ws-1', remoteUrl: 'https://github.com/acme/widgets.git' });
      expect(githubHandlers.setupGit).toHaveBeenCalledWith('ws-1', 'https://github.com/acme/widgets.git', undefined);
    });

    it('githubPrView routes to prView(workspaceId, number, host)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrView)(validEvent, { workspaceId: 'ws-1', number: 42 });
      expect(githubHandlers.prView).toHaveBeenCalledWith('ws-1', 42, undefined);
    });

    it('githubPrEdit routes to prEdit with the parsed input', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrEdit)(validEvent, { workspaceId: 'ws-1', number: 42, addLabels: ['bug'] });
      expect(githubHandlers.prEdit).toHaveBeenCalledWith('ws-1', 42, { addLabels: ['bug'] }, undefined);
    });

    it('githubPrCheckout routes to prCheckout(projectId, number, host)', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubPrCheckout)(validEvent, { projectId: 'p-1', number: 42 });
      expect(githubHandlers.prCheckout).toHaveBeenCalledWith('p-1', 42, undefined);
    });

    it('githubIssueView / githubIssueEdit / githubIssueComment / githubIssueClose / githubIssueReopen route through, with reason optional', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubIssueView)(validEvent, { workspaceId: 'ws-1', number: 7 });
      expect(githubHandlers.issuesView).toHaveBeenCalledWith('ws-1', 7, undefined);
      await handlerFor(IPC_CHANNELS.githubIssueEdit)(validEvent, { workspaceId: 'ws-1', number: 7, title: 'New title' });
      expect(githubHandlers.issuesEdit).toHaveBeenCalledWith('ws-1', 7, { title: 'New title' }, undefined);
      await handlerFor(IPC_CHANNELS.githubIssueComment)(validEvent, { workspaceId: 'ws-1', number: 7, body: 'On it' });
      expect(githubHandlers.issuesComment).toHaveBeenCalledWith('ws-1', 7, 'On it', undefined);
      await handlerFor(IPC_CHANNELS.githubIssueClose)(validEvent, { workspaceId: 'ws-1', number: 7 });
      expect(githubHandlers.issuesClose).toHaveBeenCalledWith('ws-1', 7, undefined, undefined);
      await handlerFor(IPC_CHANNELS.githubIssueReopen)(validEvent, { workspaceId: 'ws-1', number: 7 });
      expect(githubHandlers.issuesReopen).toHaveBeenCalledWith('ws-1', 7, undefined);
    });

    it('githubIssueStartWork routes to issuesStartWork with the issue reassembled from flat fields', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubIssueStartWork)(validEvent, { projectId: 'p-1', issueNumber: 7, issueTitle: 'Add widget filtering', baseBranch: 'main' });
      expect(githubHandlers.issuesStartWork).toHaveBeenCalledWith('p-1', { number: 7, title: 'Add widget filtering' }, 'main');
    });

    it('githubActionsListWorkflows / githubActionsWorkflowInputs route through', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubActionsListWorkflows)(validEvent, { workspaceId: 'ws-1' });
      expect(githubHandlers.actionsListWorkflows).toHaveBeenCalledWith('ws-1', undefined);
      await handlerFor(IPC_CHANNELS.githubActionsWorkflowInputs)(validEvent, { workspaceId: 'ws-1', nameWithOwner: 'acme/widgets', workflowPath: '.github/workflows/release.yml' });
      expect(githubHandlers.actionsWorkflowInputs).toHaveBeenCalledWith('ws-1', 'acme/widgets', '.github/workflows/release.yml', undefined, undefined);
    });

    it('githubActionsTrigger requires confirmed:true, same shape as prMerge', async () => {
      const { githubHandlers } = setup();
      await expect(
        handlerFor(IPC_CHANNELS.githubActionsTrigger)(validEvent, { workspaceId: 'ws-1', workflow: 'release.yml', ref: 'main', inputs: {} }),
      ).rejects.toThrow();
      expect(githubHandlers.actionsTrigger).not.toHaveBeenCalled();
      await handlerFor(IPC_CHANNELS.githubActionsTrigger)(validEvent, { workspaceId: 'ws-1', workflow: 'release.yml', ref: 'main', inputs: { env: 'prod' }, confirmed: true });
      expect(githubHandlers.actionsTrigger).toHaveBeenCalledWith('ws-1', 'release.yml', 'main', { env: 'prod' }, true, undefined);
    });

    it('githubActionsViewRun / githubActionsRunLog / githubActionsCancel / githubActionsRerun route through', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubActionsViewRun)(validEvent, { workspaceId: 'ws-1', id: 99 });
      expect(githubHandlers.actionsViewRun).toHaveBeenCalledWith('ws-1', 99, undefined);
      await handlerFor(IPC_CHANNELS.githubActionsRunLog)(validEvent, { workspaceId: 'ws-1', id: 99 });
      expect(githubHandlers.actionsRunLog).toHaveBeenCalledWith('ws-1', 99, undefined);
      await handlerFor(IPC_CHANNELS.githubActionsCancel)(validEvent, { workspaceId: 'ws-1', id: 99 });
      expect(githubHandlers.actionsCancel).toHaveBeenCalledWith('ws-1', 99, undefined);
      await handlerFor(IPC_CHANNELS.githubActionsRerun)(validEvent, { workspaceId: 'ws-1', id: 99, failedOnly: true });
      expect(githubHandlers.actionsRerun).toHaveBeenCalledWith('ws-1', 99, true, undefined);
    });

    it('githubActionsDownloadArtifacts routes with the already-picked destinationDir', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubActionsDownloadArtifacts)(validEvent, { workspaceId: 'ws-1', id: 99, destinationDir: '/tmp/artifacts' });
      expect(githubHandlers.actionsDownloadArtifacts).toHaveBeenCalledWith('ws-1', 99, '/tmp/artifacts', undefined, undefined);
    });

    it('githubReleaseSuggestVersion / githubReleaseNotes route through as pure/read reads', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubReleaseSuggestVersion)(validEvent, { previousTag: 'v1.2.3', commitSubjects: ['fix: bug'] });
      expect(githubHandlers.releaseSuggestVersion).toHaveBeenCalledWith('v1.2.3', ['fix: bug']);
      await handlerFor(IPC_CHANNELS.githubReleaseNotes)(validEvent, { workspaceId: 'ws-1', nameWithOwner: 'acme/widgets', tagName: 'v1.3.0' });
      expect(githubHandlers.releaseNotes).toHaveBeenCalledWith('ws-1', 'acme/widgets', 'v1.3.0', undefined, undefined);
    });

    it('githubReleaseCreateDraft routes to releaseCreateDraft with a reassembled ReleaseCreateInput', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubReleaseCreateDraft)(validEvent, {
        projectId: 'p-1',
        tagMessage: 'Release v1.3.0',
        tagName: 'v1.3.0',
        title: 'v1.3.0',
        notes: 'Notes',
      });
      expect(githubHandlers.releaseCreateDraft).toHaveBeenCalledWith('p-1', 'Release v1.3.0', { tagName: 'v1.3.0', title: 'v1.3.0', notes: 'Notes' }, undefined);
    });

    it('githubReleasePublish rejects unconfirmed and routes once confirmed', async () => {
      const { githubHandlers } = setup();
      await expect(
        handlerFor(IPC_CHANNELS.githubReleasePublish)(validEvent, { workspaceId: 'ws-1', tagName: 'v1.3.0' }),
      ).rejects.toThrow();
      expect(githubHandlers.releasePublish).not.toHaveBeenCalled();
      await handlerFor(IPC_CHANNELS.githubReleasePublish)(validEvent, { workspaceId: 'ws-1', tagName: 'v1.3.0', confirmed: true });
      expect(githubHandlers.releasePublish).toHaveBeenCalledWith('ws-1', 'v1.3.0', true, undefined);
    });

    it('githubReleaseTriggerWorkflow rejects unconfirmed and routes once confirmed', async () => {
      const { githubHandlers } = setup();
      await expect(
        handlerFor(IPC_CHANNELS.githubReleaseTriggerWorkflow)(validEvent, { workspaceId: 'ws-1', workflow: 'publish.yml', ref: 'v1.3.0', inputs: {} }),
      ).rejects.toThrow();
      expect(githubHandlers.releaseTriggerWorkflow).not.toHaveBeenCalled();
      await handlerFor(IPC_CHANNELS.githubReleaseTriggerWorkflow)(validEvent, { workspaceId: 'ws-1', workflow: 'publish.yml', ref: 'v1.3.0', inputs: {}, confirmed: true });
      expect(githubHandlers.releaseTriggerWorkflow).toHaveBeenCalledWith('ws-1', 'publish.yml', 'v1.3.0', {}, true, undefined);
    });

    it('githubReleaseUploadArtifacts routes with already-picked filePaths', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubReleaseUploadArtifacts)(validEvent, { workspaceId: 'ws-1', tagName: 'v1.3.0', filePaths: ['/tmp/app.dmg'] });
      expect(githubHandlers.releaseUploadArtifactFiles).toHaveBeenCalledWith('ws-1', 'v1.3.0', ['/tmp/app.dmg'], undefined);
    });

    it('githubReleasePickArtifactFiles opens a multi-file picker and returns the picked paths', async () => {
      setup();
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/app.dmg', '/tmp/app.dmg.sig'] });
      fromWebContents.mockReturnValue({ id: 'win-1' });
      const result = await handlerFor(IPC_CHANNELS.githubReleasePickArtifactFiles)(validEvent);
      expect(showOpenDialog).toHaveBeenCalledWith({ id: 'win-1' }, { properties: ['openFile', 'multiSelections'] });
      expect(result).toEqual(['/tmp/app.dmg', '/tmp/app.dmg.sig']);
    });

    it('githubReleasePickArtifactFiles resolves null when the dialog is cancelled', async () => {
      setup();
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      fromWebContents.mockReturnValue({ id: 'win-1' });
      const result = await handlerFor(IPC_CHANNELS.githubReleasePickArtifactFiles)(validEvent);
      expect(result).toBeNull();
    });

    it('githubRemoteAvailability routes to remoteAvailability with the parsed connectivity', async () => {
      const { githubHandlers } = setup();
      await handlerFor(IPC_CHANNELS.githubRemoteAvailability)(validEvent, { connectivity: 'offline' });
      expect(githubHandlers.remoteAvailability).toHaveBeenCalledWith('offline');
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
