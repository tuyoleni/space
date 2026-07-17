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
    updateDependencies: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectUpdateDependencies, input),
    environmentInfo: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectEnvironmentInfo, input),
    pickParentDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.projectPickParentDirectory),
    opened: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.projectOpened, projectId),
    icon: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectIcon, input),
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
  services: {
    list: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.servicesList, projectId),
    stop: (input) => ipcRenderer.invoke(IPC_CHANNELS.servicesStop, input),
  },
  git: {
    status: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStatus, input),
    initRepo: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitInit, input),
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
    diffStats: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitDiffStats, input),
    diffFile: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitDiffFile, input),
    listRemotes: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitRemoteList, input),
    listStashes: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStashList, input),
    applyStash: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStashApply, input),
    dropStash: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitStashDrop, input),
    listTags: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitTagList, input),
    listWorktrees: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitWorktreeList, input),
    resolveConflict: (input) => ipcRenderer.invoke(IPC_CHANNELS.gitConflictResolve, input),
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
  agent: {
    diffLoad: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentDiffLoad, input),
    intentGenerate: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentIntentGenerate, input),
    commitCompose: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentCommitCompose, input),
    planDispatch: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentPlanDispatch, input),
    permissionGrant: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentPermissionGrant, input),
    permissionRevoke: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentPermissionRevoke, input),
    permissionList: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.agentPermissionList, workspaceId),
  },
  ai: {
    keyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiKeyStatus),
    setApiKey: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiSetApiKey, input),
    reviewComments: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiReviewComments, input),
    applyFix: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiApplyFix, input),
    generateCommitMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerateCommitMessage, input),
  },
  bootstrap: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrapGetStatus),
    buildPlan: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrapBuildPlan),
    runNextStep: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrapRunNextStep),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrapCancel),
  },
  automation: {
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationCreate, input),
    list: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.automationList, workspaceId),
    setEnabled: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationSetEnabled, input),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.automationDelete, id),
    listRuns: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationListRuns, input),
    getAllEnabled: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.automationSettingsGet, workspaceId),
    setAllEnabled: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationSettingsSet, input),
  },
  appSettings: {
    getTelemetryEnabled: () => ipcRenderer.invoke(IPC_CHANNELS.appSettingsTelemetryGet),
    setTelemetryEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.appSettingsTelemetrySet, { enabled }),
  },
  environment: {
    scan: (input) => ipcRenderer.invoke(IPC_CHANNELS.environmentScan, input),
    installTool: (input) => ipcRenderer.invoke(IPC_CHANNELS.environmentInstallTool, input),
    updateTool: (input) => ipcRenderer.invoke(IPC_CHANNELS.environmentUpdateTool, input),
    exportReport: (input) => ipcRenderer.invoke(IPC_CHANNELS.environmentExportReport, input),
  },
  connectedServices: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.connectedServicesStatus),
    startLogin: (input) => ipcRenderer.invoke(IPC_CHANNELS.connectedServicesStartLogin, input),
    deploy: (input) => ipcRenderer.invoke(IPC_CHANNELS.connectedServicesDeploy, input),
  },
  packages: {
    listInstalled: () => ipcRenderer.invoke(IPC_CHANNELS.packagesListInstalled),
    search: (input) => ipcRenderer.invoke(IPC_CHANNELS.packagesSearch, input),
    install: (input) => ipcRenderer.invoke(IPC_CHANNELS.packagesInstall, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.packagesUpdate, input),
    uninstall: (input) => ipcRenderer.invoke(IPC_CHANNELS.packagesUninstall, input),
  },
  menu: {
    onCommand: (listener) => {
      const handler = (_event: IpcRendererEvent, command: Parameters<typeof listener>[0]) => listener(command);
      ipcRenderer.on(IPC_CHANNELS.menuCommand, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.menuCommand, handler);
    },
  },
  system: {
    stats: () => ipcRenderer.invoke(IPC_CHANNELS.systemStats),
    processes: () => ipcRenderer.invoke(IPC_CHANNELS.systemProcesses),
  },
  dependencies: {
    scan: (input) => ipcRenderer.invoke(IPC_CHANNELS.dependencyScan, input),
  },
};

contextBridge.exposeInMainWorld('space', spaceAPI);
