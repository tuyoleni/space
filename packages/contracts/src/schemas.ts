import { z } from 'zod';

/**
 * Runtime validation for every IPC input (spec sections 20.1, 22.1: "every
 * request... plus runtime validation", "no channel accepts arbitrary...
 * without domain validation"). Main-process handlers must parse the raw
 * IPC payload through these before touching storage or the filesystem.
 */
export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  iconToken: z.string().min(1).max(100).optional(),
  defaultProjectDirectory: z.string().min(1).optional(),
});

export const workspaceActivateInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const inspectFolderInputSchema = z.object({
  path: z.string().min(1),
});

export const projectListInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const addProjectInputSchema = z.object({
  workspaceId: z.string().min(1),
  canonicalPath: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// M4
// ---------------------------------------------------------------------------

export const detectProjectInputSchema = z.object({
  canonicalPath: z.string().min(1),
});

export const detectPackageManagerInputSchema = z.object({
  canonicalPath: z.string().min(1),
});

const jsPackageManagerIdSchema = z.enum(['npm', 'yarn', 'pnpm']);

export const installDependenciesInputSchema = z.object({
  projectId: z.string().min(1),
  packageManager: jsPackageManagerIdSchema.optional(),
  allowOnce: z.boolean().optional(),
});

const trustDecisionSchema = z.enum(['allow-once', 'trust-this-project', 'keep-untrusted']);

export const projectTrustDecisionInputSchema = z.object({
  projectId: z.string().min(1),
  decision: trustDecisionSchema,
});

export const gitInitInputSchema = z.object({
  projectId: z.string().min(1),
});

/** Storage-worker-internal — called by git-handlers.ts only after a real `git init` has already succeeded, never directly by the renderer. */
export const projectSetRepositoryRootInputSchema = z.object({
  projectId: z.string().min(1),
  repositoryRoot: z.string().min(1),
});

const projectTemplateOptionValueSchema = z.union([z.string(), z.boolean()]);

export const createProjectFromTemplateInputSchema = z.object({
  workspaceId: z.string().min(1),
  templateId: z.string().min(1),
  destinationParentDirectory: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // Directory-name safety: no path separators or leading dot-dot traversal.
    .regex(/^[^/\\]+$/, 'name must not contain a path separator')
    .refine((value) => value !== '.' && value !== '..', 'name must not be "." or ".."'),
  options: z.record(z.string(), projectTemplateOptionValueSchema).optional(),
});

export const cloneProjectInputSchema = z.object({
  workspaceId: z.string().min(1),
  remoteUrl: z.string().min(1).refine((value) => !value.startsWith('-'), 'remote must not look like a flag'),
  destinationParentDirectory: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^/\\]+$/, 'name must not contain a path separator')
    .optional(),
  branch: z.string().trim().min(1).max(250).optional(),
});

export const createTerminalInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  cols: z.number().int().min(1).max(2000),
  rows: z.number().int().min(1).max(2000),
});

export const terminalWriteInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string(),
});

export const terminalResizeInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(1).max(2000),
  rows: z.number().int().min(1).max(2000),
});

export const terminalDisposeInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const startDevServerInputSchema = z.object({
  projectId: z.string().min(1),
  allowOnce: z.boolean().optional(),
});

export const stopDevServerInputSchema = z.object({
  devProcessId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// M5: Git (GIT-001..009, spec sections 11-12)
// ---------------------------------------------------------------------------

export const gitProjectInputSchema = z.object({
  projectId: z.string().min(1),
});

export const gitStageInputSchema = z.object({
  projectId: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
});

export const gitFileDiffInputSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  staged: z.boolean(),
});

export const gitCommitInputSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().trim().min(1).max(10_000),
});

export const gitCreateBranchInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(250),
  fromCommit: z.string().min(1).optional(),
});

export const gitSwitchBranchInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(250),
});

export const gitDeleteBranchInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(250),
  force: z.boolean(),
  confirmed: z.boolean(),
});

export const gitHistoryLoadInputSchema = z.object({
  projectId: z.string().min(1),
  offset: z.number().int().min(0),
  count: z.number().int().min(1).max(5000),
});

export const gitFetchInputSchema = z.object({
  projectId: z.string().min(1),
  remoteName: z.string().trim().min(1).max(250).optional(),
});

const gitPullModeSchema = z.enum(['merge', 'rebase']);

export const gitPullInputSchema = z.object({
  projectId: z.string().min(1),
  mode: gitPullModeSchema,
  remoteName: z.string().trim().min(1).max(250).optional(),
  branch: z.string().trim().min(1).max(250).optional(),
});

const gitForceModeSchema = z.enum(['none', 'with-lease', 'raw']);

export const gitPushInputSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().trim().min(1).max(250),
  remoteName: z.string().trim().min(1).max(250).optional(),
  setUpstream: z.boolean().optional(),
  force: gitForceModeSchema.optional(),
  confirmed: z.boolean().optional(),
});

export const gitConflictResolveInputSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  side: z.enum(['ours', 'theirs']),
});

export const gitStashActionInputSchema = z.object({
  projectId: z.string().min(1),
  index: z.number().int().min(0),
  confirmed: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// M5: activity (spec section 17)
// ---------------------------------------------------------------------------

export const activityListRangeInputSchema = z.object({
  workspaceId: z.string().min(1),
  fromInclusive: z.string().min(1),
  toInclusive: z.string().min(1),
});

// ---------------------------------------------------------------------------
// M6: GitHub (spec section 14, GH-001..009)
// ---------------------------------------------------------------------------

export const githubAuthReportInputSchema = z.object({
  workspaceId: z.string().min(1),
  host: z.string().min(1).optional(),
});

export const githubAuthStartLoginInputSchema = z.object({
  workspaceId: z.string().min(1),
  host: z.string().min(1).optional(),
  webFlow: z.boolean().optional(),
});

export const githubAuthLogoutInputSchema = z.object({
  workspaceId: z.string().min(1),
  host: z.string().min(1).optional(),
});

const githubRepoVisibilitySchema = z.enum(['public', 'private', 'internal']);

export const githubRepoPlanPublishInputSchema = z.object({
  workspaceId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1).optional(),
});

export const githubRepoPublishInputSchema = z.object({
  projectId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  visibility: githubRepoVisibilitySchema,
  description: z.string().min(1).optional(),
  sourceFolder: z.string().min(1),
  remoteName: z.string().min(1).optional(),
  push: z.boolean(),
  connect: z.object({ nameWithOwner: z.string().min(1), url: z.string().min(1) }).optional(),
});

export const githubPullRequestListInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  state: z.enum(['open', 'closed', 'merged', 'all']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const githubPullRequestCreateInputSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  head: z.string().min(1),
  draft: z.boolean().optional(),
  // GH-004 (spec 14.6): "Add reviewers, assignees, labels ... where permissions allow."
  reviewers: z.array(z.string().min(1)).optional(),
  assignees: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string().min(1)).optional(),
});

export const githubPullRequestMergeInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  method: z.enum(['merge', 'squash', 'rebase']),
  deleteBranch: z.boolean().optional(),
  confirmed: z.boolean(),
});

export const githubIssueListInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
  search: z.string().min(1).optional(),
});

export const githubIssueCreateInputSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  // GH-007 (spec 14.9): "Support ... create, edit, assign, label ..."
  labels: z.array(z.string().min(1)).optional(),
  assignees: z.array(z.string().min(1)).optional(),
});

export const githubChecksLoadInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  nameWithOwner: z.string().min(1),
  branch: z.string().min(1),
});

export const githubActionsListRunsInputSchema = z.object({
  workspaceId: z.string().min(1),
  workflow: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const githubReleaseCompareInputSchema = z.object({
  workspaceId: z.string().min(1),
  nameWithOwner: z.string().min(1),
  sinceTag: z.string().min(1),
  head: z.string().min(1),
});

// ---------------------------------------------------------------------------
// M6 (continued): the rest of GH-001..009's surface (see types.ts's matching
// comment for why this exists alongside the smaller slice above).
// ---------------------------------------------------------------------------

export const githubSetupGitInputSchema = z.object({
  workspaceId: z.string().min(1),
  remoteUrl: z.string().min(1),
  host: z.string().min(1).optional(),
});

export const githubPrViewInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubPullRequestEditInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  addReviewers: z.array(z.string().min(1)).optional(),
  addAssignees: z.array(z.string().min(1)).optional(),
  addLabels: z.array(z.string().min(1)).optional(),
  host: z.string().min(1).optional(),
});

export const githubPrCheckoutInputSchema = z.object({
  projectId: z.string().min(1),
  number: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubIssueViewInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubIssueEditInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  addLabels: z.array(z.string().min(1)).optional(),
  removeLabels: z.array(z.string().min(1)).optional(),
  addAssignees: z.array(z.string().min(1)).optional(),
  removeAssignees: z.array(z.string().min(1)).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
});

export const githubIssueCommentInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  body: z.string().min(1),
  host: z.string().min(1).optional(),
});

export const githubIssueCloseInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  reason: z.enum(['completed', 'not planned']).optional(),
  host: z.string().min(1).optional(),
});

export const githubIssueReopenInputSchema = z.object({
  workspaceId: z.string().min(1),
  number: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubIssueStartWorkInputSchema = z.object({
  projectId: z.string().min(1),
  issueNumber: z.number().int().positive(),
  issueTitle: z.string().min(1),
  baseBranch: z.string().min(1),
});

export const githubActionsListWorkflowsInputSchema = z.object({
  workspaceId: z.string().min(1),
  host: z.string().min(1).optional(),
});

export const githubActionsWorkflowInputsInputSchema = z.object({
  workspaceId: z.string().min(1),
  nameWithOwner: z.string().min(1),
  workflowPath: z.string().min(1),
  ref: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
});

export const githubActionsTriggerInputSchema = z.object({
  workspaceId: z.string().min(1),
  workflow: z.string().min(1),
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()),
  confirmed: z.boolean(),
  host: z.string().min(1).optional(),
});

export const githubActionsViewRunInputSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubActionsRunLogInputSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubActionsDownloadArtifactsInputSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.number().int().positive(),
  destinationDir: z.string().min(1),
  artifactName: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
});

export const githubActionsCancelInputSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.number().int().positive(),
  host: z.string().min(1).optional(),
});

export const githubActionsRerunInputSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.number().int().positive(),
  failedOnly: z.boolean(),
  host: z.string().min(1).optional(),
});

export const githubReleaseSuggestVersionInputSchema = z.object({
  previousTag: z.string().min(1),
  commitSubjects: z.array(z.string()),
});

export const githubReleaseNotesInputSchema = z.object({
  workspaceId: z.string().min(1),
  nameWithOwner: z.string().min(1),
  tagName: z.string().min(1),
  targetCommitish: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
});

export const githubReleaseCreateDraftInputSchema = z.object({
  projectId: z.string().min(1),
  tagMessage: z.string().min(1),
  tagName: z.string().min(1),
  title: z.string().min(1),
  notes: z.string(),
  target: z.string().min(1).optional(),
  prerelease: z.boolean().optional(),
  remoteName: z.string().min(1).optional(),
});

export const githubReleasePublishInputSchema = z.object({
  workspaceId: z.string().min(1),
  tagName: z.string().min(1),
  confirmed: z.boolean(),
  host: z.string().min(1).optional(),
});

export const githubReleaseTriggerWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  workflow: z.string().min(1),
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()),
  confirmed: z.boolean(),
  host: z.string().min(1).optional(),
});

export const githubReleaseUploadArtifactsInputSchema = z.object({
  workspaceId: z.string().min(1),
  tagName: z.string().min(1),
  filePaths: z.array(z.string().min(1)),
  host: z.string().min(1).optional(),
});

export const githubRemoteAvailabilityInputSchema = z.object({
  connectivity: z.enum(['online', 'degraded', 'offline']),
});

// ---------------------------------------------------------------------------
// M7: intent/agent layer (spec sections 13, 19). These validate only the
// transport envelope — `evidence`/`action` are opaque here and get their
// real, strict validation inside @space/agent (ChangeIntentSchema,
// AgentActionSchema), which every model-produced or otherwise untrusted
// payload must pass before anything acts on it.
// ---------------------------------------------------------------------------

export const agentDiffLoadInputSchema = z.object({
  projectId: z.string().min(1),
});

export const agentIntentGenerateInputSchema = z.object({
  evidence: z.array(z.unknown()),
});

export const agentCommitComposeInputSchema = z.object({
  projectId: z.string().min(1),
  evidence: z.array(z.unknown()),
  message: z.string().min(1),
});

export const agentPlanDispatchInputSchema = z.object({
  action: z.unknown(),
  confirmed: z.boolean(),
});

export const agentPermissionGrantInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  actionType: z.string().min(1),
});

export const agentPermissionRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export const aiSetApiKeyInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(500),
});

export const aiReviewCommentsInputSchema = z.object({
  projectId: z.string().min(1),
});

export const aiApplyFixInputSchema = z.object({
  projectId: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().min(1),
  originalLine: z.string(),
  newLine: z.string(),
});

export const aiGenerateCommitMessageInputSchema = z.object({
  projectId: z.string().min(1),
  filePaths: z.array(z.string().min(1)),
});

// ---------------------------------------------------------------------------
// M8: automation (spec section 18). `trigger`/`conditions`/`actions` are
// validated for real by @space/automation's own schemas inside
// automation-handlers.ts — this layer only validates the transport
// envelope, matching the M7 agent-plan convention this file already
// documents.
// ---------------------------------------------------------------------------

export const automationListInputSchema = z.object({ workspaceId: z.string().min(1) });

export const automationCreateInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(200),
  trigger: z.unknown(),
  conditions: z.array(z.unknown()),
  actions: z.array(z.unknown()),
});

export const automationSetEnabledInputSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export const automationDeleteInputSchema = z.object({ id: z.string().min(1) });

export const automationListRunsInputSchema = z.object({
  automationId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
});

export const automationSettingsGetInputSchema = z.object({ workspaceId: z.string().min(1) });

export const automationSettingsSetInputSchema = z.object({
  workspaceId: z.string().min(1),
  enabled: z.boolean(),
});

/** M8: the `project-opened` trigger's transport envelope (spec 18.2) — just the project id. */
export const projectOpenedInputSchema = z.object({ projectId: z.string().min(1) });

/** M8: telemetry opt-in (spec 29.2) — app-level, not workspace-scoped. */
export const appSettingsTelemetrySetInputSchema = z.object({ enabled: z.boolean() });

export const environmentToolActionInputSchema = z.object({
  toolId: z.string().min(1),
  allowOnce: z.boolean().optional(),
});

/** `scan`/`connectedServices` are the renderer's own prior IPC-response shapes (not further constrained here) written back to a file as-is. */
export const environmentExportReportInputSchema = z.object({
  scan: z.unknown(),
  connectedServices: z.unknown().nullable().optional(),
});

export const projectEnvironmentInfoInputSchema = z.object({ projectId: z.string().min(1) });

const connectedServiceIdSchema = z.enum(['docker', 'vercel', 'supabase', 'gcloud']);

export const connectedServiceLoginInputSchema = z.object({
  workspaceId: z.string().min(1),
  service: connectedServiceIdSchema,
});

export const connectedServiceDeployInputSchema = z.object({
  projectId: z.string().min(1),
  service: connectedServiceIdSchema,
});

const packageSourceSchema = z.enum(['homebrew-formula', 'homebrew-cask', 'npm-global', 'winget']);

export const packageSearchInputSchema = z.object({ query: z.string().trim().min(1).max(200) });

export const packageActionInputSchema = z.object({
  source: packageSourceSchema,
  name: z.string().trim().min(1).max(200),
});
