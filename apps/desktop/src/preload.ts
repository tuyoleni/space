// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

/**
 * Exposes exactly the SpaceAPI surface (spec section 22.2) via
 * contextBridge — no `ipcRenderer`, no broad file or shell primitives, and
 * no method that resembles `runCommand(command: string)`. `terminal.
 * subscribe` is the one exception to "every call is invoke/response": it
 * listens on the push-only `terminal:event` channel and filters by
 * sessionId, matching spec 22.2's operation.subscribe(id, listener):
 * Unsubscribe shape — the renderer still never receives `ipcRenderer`
 * itself, only this narrow, pre-filtered callback registration.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type SpaceAPI, type TerminalEvent } from '@space/contracts';

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

    detect: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectDetect, input),
    detectPackageManager: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectDetectPackageManager, input),
    trustDecision: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectTrustDecision, input),
    listTemplates: () => ipcRenderer.invoke(IPC_CHANNELS.projectListTemplates),
    createFromTemplate: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectCreateFromTemplate, input),
    clone: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectClone, input),
    installDependencies: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectInstallDependencies, input),
    pickParentDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.projectPickParentDirectory),
  },
  terminal: {
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
    write: (input) => ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, input),
    resize: (input) => ipcRenderer.invoke(IPC_CHANNELS.terminalResize, input),
    dispose: (input) => ipcRenderer.invoke(IPC_CHANNELS.terminalDispose, input),
    list: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.terminalList, workspaceId),
    subscribe: (sessionId, listener) => {
      const handler = (_event: IpcRendererEvent, payload: TerminalEvent) => {
        if (payload.sessionId === sessionId) {
          listener(payload);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.terminalEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalEvent, handler);
    },
  },
  devServer: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.devServerStart, input),
    stop: (input) => ipcRenderer.invoke(IPC_CHANNELS.devServerStop, input),
    list: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.devServerList, projectId),
  },
  git: {
    status: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStatus, input),
    stage: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStage, input),
    unstage: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitUnstage, input),
    commit: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitCommit, input),
    listBranches: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitBranchList, input),
    createBranch: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitBranchCreate, input),
    switchBranch: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitBranchSwitch, input),
    deleteBranch: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitBranchDelete, input),
    loadHistory: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitHistoryLoad, input),
    fetch: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitFetch, input),
    pull: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitPull, input),
    push: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitPush, input),
    conflictState: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitConflictState, input),
    continueConflict: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitConflictContinue, input),
    abortConflict: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitConflictAbort, input),
  },
  activity: {
    listRange: (input) => ipcRenderer.invoke(IPC_CHANNELS.activityListRange, input),
  },
  github: {
    authReport: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubAuthReport, input),
    authStartLogin: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubAuthStartLogin, input),
    authLogout: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubAuthLogout, input),
    setupGit: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubSetupGit, input),
    repoPlanPublish: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubRepoPlanPublish, input),
    repoPublish: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubRepoPublish, input),
    prList: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrList, input),
    prView: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrView, input),
    prCreate: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrCreate, input),
    prEdit: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrEdit, input),
    prCheckout: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrCheckout, input),
    prMerge: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubPrMerge, input),
    issueList: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueList, input),
    issueView: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueView, input),
    issueCreate: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueCreate, input),
    issueEdit: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueEdit, input),
    issueComment: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueComment, input),
    issueClose: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueClose, input),
    issueReopen: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueReopen, input),
    issueStartWork: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubIssueStartWork, input),
    checksLoad: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubChecksLoad, input),
    actionsListWorkflows: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsListWorkflows, input),
    actionsListRuns: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsListRuns, input),
    actionsWorkflowInputs: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsWorkflowInputs, input),
    actionsTrigger: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsTrigger, input),
    actionsViewRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsViewRun, input),
    actionsRunLog: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsRunLog, input),
    actionsDownloadArtifacts: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsDownloadArtifacts, input),
    actionsCancel: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsCancel, input),
    actionsRerun: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubActionsRerun, input),
    releaseCompare: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseCompare, input),
    releaseSuggestVersion: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseSuggestVersion, input),
    releaseNotes: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseNotes, input),
    releaseCreateDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseCreateDraft, input),
    releasePublish: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleasePublish, input),
    releaseTriggerWorkflow: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseTriggerWorkflow, input),
    releaseUploadArtifacts: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubReleaseUploadArtifacts, input),
    releasePickArtifactFiles: () => ipcRenderer.invoke(IPC_CHANNELS.githubReleasePickArtifactFiles),
    remoteAvailability: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubRemoteAvailability, input),
  },
};

contextBridge.exposeInMainWorld('space', spaceAPI);
