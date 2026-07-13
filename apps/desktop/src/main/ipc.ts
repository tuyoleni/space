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
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  activityListRangeInputSchema,
  agentCommitComposeInputSchema,
  agentDiffLoadInputSchema,
  agentIntentGenerateInputSchema,
  agentPermissionGrantInputSchema,
  agentPermissionRevokeInputSchema,
  agentPlanDispatchInputSchema,
  appSettingsTelemetrySetInputSchema,
  automationCreateInputSchema,
  automationDeleteInputSchema,
  automationListInputSchema,
  automationListRunsInputSchema,
  automationSetEnabledInputSchema,
  automationSettingsGetInputSchema,
  automationSettingsSetInputSchema,
  gitCommitInputSchema,
  gitCreateBranchInputSchema,
  gitDeleteBranchInputSchema,
  gitFetchInputSchema,
  gitHistoryLoadInputSchema,
  gitProjectInputSchema,
  gitPullInputSchema,
  gitPushInputSchema,
  gitStageInputSchema,
  gitSwitchBranchInputSchema,
  githubActionsCancelInputSchema,
  githubActionsDownloadArtifactsInputSchema,
  githubActionsListRunsInputSchema,
  githubActionsListWorkflowsInputSchema,
  githubActionsRerunInputSchema,
  githubActionsRunLogInputSchema,
  githubActionsTriggerInputSchema,
  githubActionsViewRunInputSchema,
  githubActionsWorkflowInputsInputSchema,
  githubAuthLogoutInputSchema,
  githubAuthReportInputSchema,
  githubAuthStartLoginInputSchema,
  githubChecksLoadInputSchema,
  githubIssueCloseInputSchema,
  githubIssueCommentInputSchema,
  githubIssueCreateInputSchema,
  githubIssueEditInputSchema,
  githubIssueListInputSchema,
  githubIssueReopenInputSchema,
  githubIssueStartWorkInputSchema,
  githubIssueViewInputSchema,
  githubPrCheckoutInputSchema,
  githubPrViewInputSchema,
  githubPullRequestCreateInputSchema,
  githubPullRequestEditInputSchema,
  githubPullRequestListInputSchema,
  githubPullRequestMergeInputSchema,
  githubReleaseCompareInputSchema,
  githubReleaseCreateDraftInputSchema,
  githubReleaseNotesInputSchema,
  githubReleasePublishInputSchema,
  githubReleaseSuggestVersionInputSchema,
  githubReleaseTriggerWorkflowInputSchema,
  githubReleaseUploadArtifactsInputSchema,
  githubRemoteAvailabilityInputSchema,
  githubRepoPlanPublishInputSchema,
  githubRepoPublishInputSchema,
  githubSetupGitInputSchema,
  projectOpenedInputSchema,
  IPC_CHANNELS,
  type TerminalEvent,
} from '@space/contracts';
import { createLogger, type Logger } from '@space/logging';
import { assertIpcSender, type TrustedSender } from '@space/security';
import type { AgentHandlers } from './agent-handlers';
import type { AutomationHandlers } from './automation-handlers';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
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

/**
 * Fires a real automation trigger event (spec 18.2) from an already-
 * successful mutation — the exact "wire to signals that already exist"
 * pattern the M8 automation engine is built around, rather than any new
 * detection machinery. A failure here (a bad automation configuration, a
 * storage hiccup) must never fail or roll back the mutation that already
 * succeeded — it is fired-and-forgotten with its own error boundary,
 * mirroring how `terminal.subscribe`'s storage bookkeeping calls above are
 * `void`-fired rather than awaited inline. Exported so main.ts can fire the
 * same trigger from a signal that lives outside this file (M8's
 * `dev-process-exited`, observed in project-handlers.ts's dev-process exit
 * callback) without duplicating this error boundary. `logger` defaults to
 * a bare console-backed one so every existing call site keeps working
 * unchanged; main.ts passes the real file-backed logger (spec 29.3).
 */
const consoleLogger: Logger = createLogger({ sink: { write: (entry) => console.error(JSON.stringify(entry)) }, minLevel: 'error' });

export function fireAutomationTrigger(
  automationHandlers: AutomationHandlers,
  event: Parameters<AutomationHandlers['handleTriggerEvent']>[0],
  logger: Logger = consoleLogger,
): void {
  void automationHandlers.handleTriggerEvent(event).catch((error) => {
    logger.error('Automation trigger handling failed', { errorMessage: error instanceof Error ? error.message : String(error), triggerType: event.type });
  });
}

async function pickDirectory(event: IpcMainInvokeEvent): Promise<string | null> {
  const window = windowForEvent(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
  const [selected] = result.filePaths;
  return result.canceled || !selected ? null : selected;
}

/** GH-008's release artifact upload needs real files, not a directory — the one file (not folder) picker in the app. */
async function pickFiles(event: IpcMainInvokeEvent): Promise<readonly string[] | null> {
  const window = windowForEvent(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
}

export function registerIpcHandlers(
  trusted: TrustedSender,
  storage: StorageClient,
  terminal: TerminalClient,
  projectHandlers: ProjectHandlers,
  gitHandlers: GitHandlers,
  githubHandlers: GithubHandlers,
  agentHandlers: AgentHandlers,
  automationHandlers: AutomationHandlers,
  logger: Logger = consoleLogger,
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

  /** M8: fires the `project-opened` automation trigger (spec 18.2) — the renderer calls this once when a project's working view is actually opened, not on every list render. */
  ipcMain.handle(IPC_CHANNELS.projectOpened, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = projectOpenedInputSchema.parse(input);
    const project = await storage.call<{ workspaceId: string } | null>('project.get', { projectId: parsed.projectId });
    if (project) {
      fireAutomationTrigger(
        automationHandlers,
        {
          type: 'project-opened',
          workspaceId: project.workspaceId,
          projectId: parsed.projectId,
          occurredAt: new Date().toISOString(),
          context: {},
        },
        logger,
      );
    }
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

  // M5: Git (GIT-001..009).

  ipcMain.handle(IPC_CHANNELS.gitStatus, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.status(gitProjectInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitStage, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.stage(gitStageInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitUnstage, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.unstage(gitStageInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitCommit, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = gitCommitInputSchema.parse(input);
    const result = await gitHandlers.commit(parsed);
    const project = await storage.call<{ workspaceId: string } | null>('project.get', { projectId: parsed.projectId });
    if (project) {
      fireAutomationTrigger(
        automationHandlers,
        {
          type: 'commit-created',
          workspaceId: project.workspaceId,
          projectId: parsed.projectId,
          occurredAt: new Date().toISOString(),
          context: { sha: result.sha },
        },
        logger,
      );
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.gitBranchList, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.listBranches(gitProjectInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitBranchCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.createBranch(gitCreateBranchInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitBranchSwitch, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.switchBranch(gitSwitchBranchInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitBranchDelete, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.deleteBranch(gitDeleteBranchInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitHistoryLoad, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.loadHistory(gitHistoryLoadInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitFetch, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.fetch(gitFetchInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitPull, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.pull(gitPullInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitPush, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = gitPushInputSchema.parse(input);
    const result = await gitHandlers.push(parsed);
    const project = await storage.call<{ workspaceId: string } | null>('project.get', { projectId: parsed.projectId });
    if (project) {
      fireAutomationTrigger(
        automationHandlers,
        {
          type: 'branch-pushed',
          workspaceId: project.workspaceId,
          projectId: parsed.projectId,
          occurredAt: new Date().toISOString(),
          context: { branch: parsed.branch },
        },
        logger,
      );
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.gitConflictState, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.conflictState(gitProjectInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitConflictContinue, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.continueConflict(gitProjectInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitConflictAbort, async (event, input) => {
    assertIpcSender(event, trusted);
    return gitHandlers.abortConflict(gitProjectInputSchema.parse(input));
  });

  // M5: activity (spec section 17).

  ipcMain.handle(IPC_CHANNELS.activityListRange, async (event, input) => {
    assertIpcSender(event, trusted);
    return storage.call('activity.listRange', activityListRangeInputSchema.parse(input));
  });

  // M6: GitHub (spec section 14, GH-001..009).

  ipcMain.handle(IPC_CHANNELS.githubAuthReport, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubAuthReportInputSchema.parse(input);
    return githubHandlers.authReport(parsed.workspaceId, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubAuthStartLogin, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubAuthStartLoginInputSchema.parse(input);
    const result = await githubHandlers.startAuthLogin({
      workspaceId: parsed.workspaceId,
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.webFlow !== undefined ? { webFlow: parsed.webFlow } : {}),
      cwd: app.getPath('home'),
    });
    // The login PTY's own output/exit stream reuses the same push channel a
    // regular terminal session uses (spec 22.2) — the renderer already
    // knows how to `terminal.subscribe(sessionId, listener)`.
    terminal.subscribe(result.sessionId, (workerEvent) => {
      const rendererEvent: TerminalEvent =
        workerEvent.type === 'output'
          ? { type: 'output', sessionId: workerEvent.sessionId, chunk: workerEvent.chunk, sequence: workerEvent.sequence, timestamp: workerEvent.timestamp }
          : workerEvent.type === 'exit'
            ? { type: 'exit', sessionId: workerEvent.sessionId, exitCode: workerEvent.exitCode, timestamp: workerEvent.timestamp }
            : { type: 'backpressure', sessionId: workerEvent.sessionId, droppedBytes: workerEvent.droppedBytes, timestamp: workerEvent.timestamp };
      sendToTrustedWindow(trusted, IPC_CHANNELS.terminalEvent, rendererEvent);
    });
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.githubAuthLogout, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubAuthLogoutInputSchema.parse(input);
    return githubHandlers.logout(parsed.workspaceId, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubRepoPlanPublish, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubRepoPlanPublishInputSchema.parse(input);
    return githubHandlers.planPublish(parsed.workspaceId, parsed.owner, parsed.name, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubRepoPublish, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubRepoPublishInputSchema.parse(input);
    return githubHandlers.publishRepository(
      parsed.projectId,
      {
        owner: parsed.owner,
        name: parsed.name,
        visibility: parsed.visibility,
        sourceFolder: parsed.sourceFolder,
        push: parsed.push,
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.remoteName !== undefined ? { remoteName: parsed.remoteName } : {}),
      },
      parsed.connect,
    );
  });

  ipcMain.handle(IPC_CHANNELS.githubPrList, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPullRequestListInputSchema.parse(input);
    return githubHandlers.prList(parsed.workspaceId, {
      ...(parsed.state !== undefined ? { state: parsed.state } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.githubPrCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPullRequestCreateInputSchema.parse(input);
    return githubHandlers.prCreate(parsed.workspaceId, {
      title: parsed.title,
      body: parsed.body,
      base: parsed.base,
      head: parsed.head,
      ...(parsed.draft !== undefined ? { draft: parsed.draft } : {}),
      ...(parsed.reviewers !== undefined ? { reviewers: parsed.reviewers } : {}),
      ...(parsed.assignees !== undefined ? { assignees: parsed.assignees } : {}),
      ...(parsed.labels !== undefined ? { labels: parsed.labels } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.githubPrMerge, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPullRequestMergeInputSchema.parse(input);
    return githubHandlers.prMerge(parsed.workspaceId, parsed.number, parsed.method, parsed.deleteBranch ?? false, parsed.confirmed);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueList, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueListInputSchema.parse(input);
    return githubHandlers.issuesList(parsed.workspaceId, {
      ...(parsed.state !== undefined ? { state: parsed.state } : {}),
      ...(parsed.search !== undefined ? { search: parsed.search } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueCreateInputSchema.parse(input);
    return githubHandlers.issuesCreate(parsed.workspaceId, {
      title: parsed.title,
      body: parsed.body,
      ...(parsed.labels !== undefined ? { labels: parsed.labels } : {}),
      ...(parsed.assignees !== undefined ? { assignees: parsed.assignees } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.githubChecksLoad, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubChecksLoadInputSchema.parse(input);
    return githubHandlers.prChecks(parsed.workspaceId, parsed.number, parsed.nameWithOwner, parsed.branch);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsListRuns, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsListRunsInputSchema.parse(input);
    return githubHandlers.actionsListRuns(parsed.workspaceId, {
      ...(parsed.workflow !== undefined ? { workflow: parsed.workflow } : {}),
      ...(parsed.branch !== undefined ? { branch: parsed.branch } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseCompare, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseCompareInputSchema.parse(input);
    return githubHandlers.releaseCompare(parsed.workspaceId, parsed.nameWithOwner, parsed.sinceTag, parsed.head);
  });

  // M6 (continued): the rest of GH-001..009's surface (see contracts'
  // matching comment for why this exists alongside the slice above).

  ipcMain.handle(IPC_CHANNELS.githubSetupGit, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubSetupGitInputSchema.parse(input);
    return githubHandlers.setupGit(parsed.workspaceId, parsed.remoteUrl, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubPrView, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPrViewInputSchema.parse(input);
    return githubHandlers.prView(parsed.workspaceId, parsed.number, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubPrEdit, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPullRequestEditInputSchema.parse(input);
    return githubHandlers.prEdit(
      parsed.workspaceId,
      parsed.number,
      {
        ...(parsed.addReviewers !== undefined ? { addReviewers: parsed.addReviewers } : {}),
        ...(parsed.addAssignees !== undefined ? { addAssignees: parsed.addAssignees } : {}),
        ...(parsed.addLabels !== undefined ? { addLabels: parsed.addLabels } : {}),
      },
      parsed.host,
    );
  });

  ipcMain.handle(IPC_CHANNELS.githubPrCheckout, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubPrCheckoutInputSchema.parse(input);
    return githubHandlers.prCheckout(parsed.projectId, parsed.number, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueView, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueViewInputSchema.parse(input);
    return githubHandlers.issuesView(parsed.workspaceId, parsed.number, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueEdit, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueEditInputSchema.parse(input);
    return githubHandlers.issuesEdit(
      parsed.workspaceId,
      parsed.number,
      {
        ...(parsed.addLabels !== undefined ? { addLabels: parsed.addLabels } : {}),
        ...(parsed.removeLabels !== undefined ? { removeLabels: parsed.removeLabels } : {}),
        ...(parsed.addAssignees !== undefined ? { addAssignees: parsed.addAssignees } : {}),
        ...(parsed.removeAssignees !== undefined ? { removeAssignees: parsed.removeAssignees } : {}),
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body } : {}),
      },
      parsed.host,
    );
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueComment, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueCommentInputSchema.parse(input);
    return githubHandlers.issuesComment(parsed.workspaceId, parsed.number, parsed.body, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueClose, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueCloseInputSchema.parse(input);
    return githubHandlers.issuesClose(parsed.workspaceId, parsed.number, parsed.reason, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueReopen, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueReopenInputSchema.parse(input);
    return githubHandlers.issuesReopen(parsed.workspaceId, parsed.number, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubIssueStartWork, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubIssueStartWorkInputSchema.parse(input);
    return githubHandlers.issuesStartWork(parsed.projectId, { number: parsed.issueNumber, title: parsed.issueTitle }, parsed.baseBranch);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsListWorkflows, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsListWorkflowsInputSchema.parse(input);
    return githubHandlers.actionsListWorkflows(parsed.workspaceId, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsWorkflowInputs, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsWorkflowInputsInputSchema.parse(input);
    return githubHandlers.actionsWorkflowInputs(parsed.workspaceId, parsed.nameWithOwner, parsed.workflowPath, parsed.ref, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsTrigger, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsTriggerInputSchema.parse(input);
    return githubHandlers.actionsTrigger(parsed.workspaceId, parsed.workflow, parsed.ref, parsed.inputs, parsed.confirmed, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsViewRun, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsViewRunInputSchema.parse(input);
    return githubHandlers.actionsViewRun(parsed.workspaceId, parsed.id, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsRunLog, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsRunLogInputSchema.parse(input);
    return githubHandlers.actionsRunLog(parsed.workspaceId, parsed.id, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsDownloadArtifacts, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsDownloadArtifactsInputSchema.parse(input);
    return githubHandlers.actionsDownloadArtifacts(parsed.workspaceId, parsed.id, parsed.destinationDir, parsed.artifactName, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsCancel, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsCancelInputSchema.parse(input);
    return githubHandlers.actionsCancel(parsed.workspaceId, parsed.id, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubActionsRerun, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubActionsRerunInputSchema.parse(input);
    return githubHandlers.actionsRerun(parsed.workspaceId, parsed.id, parsed.failedOnly, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseSuggestVersion, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseSuggestVersionInputSchema.parse(input);
    return githubHandlers.releaseSuggestVersion(parsed.previousTag, parsed.commitSubjects);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseNotes, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseNotesInputSchema.parse(input);
    return githubHandlers.releaseNotes(parsed.workspaceId, parsed.nameWithOwner, parsed.tagName, parsed.targetCommitish, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseCreateDraft, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseCreateDraftInputSchema.parse(input);
    return githubHandlers.releaseCreateDraft(
      parsed.projectId,
      parsed.tagMessage,
      {
        tagName: parsed.tagName,
        title: parsed.title,
        notes: parsed.notes,
        ...(parsed.target !== undefined ? { target: parsed.target } : {}),
        ...(parsed.prerelease !== undefined ? { prerelease: parsed.prerelease } : {}),
      },
      parsed.remoteName,
    );
  });

  ipcMain.handle(IPC_CHANNELS.githubReleasePublish, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleasePublishInputSchema.parse(input);
    return githubHandlers.releasePublish(parsed.workspaceId, parsed.tagName, parsed.confirmed, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseTriggerWorkflow, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseTriggerWorkflowInputSchema.parse(input);
    return githubHandlers.releaseTriggerWorkflow(parsed.workspaceId, parsed.workflow, parsed.ref, parsed.inputs, parsed.confirmed, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleaseUploadArtifacts, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubReleaseUploadArtifactsInputSchema.parse(input);
    return githubHandlers.releaseUploadArtifactFiles(parsed.workspaceId, parsed.tagName, parsed.filePaths, parsed.host);
  });

  ipcMain.handle(IPC_CHANNELS.githubReleasePickArtifactFiles, async (event) => {
    assertIpcSender(event, trusted);
    return pickFiles(event);
  });

  ipcMain.handle(IPC_CHANNELS.githubRemoteAvailability, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = githubRemoteAvailabilityInputSchema.parse(input);
    return githubHandlers.remoteAvailability(parsed.connectivity);
  });

  // ---------------------------------------------------------------------
  // M7: intent/agent layer (spec sections 13, 19)
  // ---------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.agentDiffLoad, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentDiffLoadInputSchema.parse(input);
    return agentHandlers.loadEvidence(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.agentIntentGenerate, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentIntentGenerateInputSchema.parse(input);
    return agentHandlers.generateIntentGroups(parsed.evidence as never);
  });

  ipcMain.handle(IPC_CHANNELS.agentCommitCompose, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentCommitComposeInputSchema.parse(input);
    return agentHandlers.composeCommit({ projectId: parsed.projectId, evidence: parsed.evidence as never, message: parsed.message });
  });

  ipcMain.handle(IPC_CHANNELS.agentPlanDispatch, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentPlanDispatchInputSchema.parse(input);
    return agentHandlers.dispatchPlan({ rawAction: parsed.action, confirmed: parsed.confirmed });
  });

  ipcMain.handle(IPC_CHANNELS.agentPermissionGrant, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentPermissionGrantInputSchema.parse(input);
    return agentHandlers.grantPermission(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.agentPermissionRevoke, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = agentPermissionRevokeInputSchema.parse(input);
    return agentHandlers.revokePermission(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.agentPermissionList, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    return agentHandlers.listPermissions(workspaceId as string);
  });

  // ---------------------------------------------------------------------
  // M8: automation (spec section 18)
  // ---------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.automationList, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    const parsed = automationListInputSchema.parse({ workspaceId });
    return automationHandlers.listAutomations(parsed.workspaceId);
  });

  ipcMain.handle(IPC_CHANNELS.automationCreate, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = automationCreateInputSchema.parse(input);
    return automationHandlers.createAutomation(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.automationSetEnabled, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = automationSetEnabledInputSchema.parse(input);
    return automationHandlers.setEnabled(parsed.id, parsed.enabled);
  });

  ipcMain.handle(IPC_CHANNELS.automationDelete, async (event, id) => {
    assertIpcSender(event, trusted);
    const parsed = automationDeleteInputSchema.parse({ id });
    return automationHandlers.deleteAutomation(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.automationListRuns, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = automationListRunsInputSchema.parse(input);
    return automationHandlers.listRuns(parsed.automationId, parsed.limit);
  });

  ipcMain.handle(IPC_CHANNELS.automationSettingsGet, async (event, workspaceId) => {
    assertIpcSender(event, trusted);
    const parsed = automationSettingsGetInputSchema.parse({ workspaceId });
    return automationHandlers.getAllEnabled(parsed.workspaceId);
  });

  ipcMain.handle(IPC_CHANNELS.automationSettingsSet, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = automationSettingsSetInputSchema.parse(input);
    return automationHandlers.setAllEnabled(parsed.workspaceId, parsed.enabled);
  });

  // ---------------------------------------------------------------------
  // M8: app-level settings (spec 29.2 telemetry opt-in, default OFF)
  // ---------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.appSettingsTelemetryGet, async (event) => {
    assertIpcSender(event, trusted);
    return storage.call<boolean>('appSettings.isTelemetryEnabled', undefined);
  });

  ipcMain.handle(IPC_CHANNELS.appSettingsTelemetrySet, async (event, input) => {
    assertIpcSender(event, trusted);
    const parsed = appSettingsTelemetrySetInputSchema.parse(input);
    return storage.call('appSettings.setTelemetryEnabled', { enabled: parsed.enabled, updatedAt: new Date().toISOString() });
  });
}
