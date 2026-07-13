/**
 * Per-method logic for the storage worker (spec sections 23, 33). Every
 * mutation is wrapped in withReceipt so it leaves a durable Operation row;
 * every input is parsed through the shared zod schemas before it touches
 * a repository (spec section 22.1: no channel accepts unvalidated input).
 *
 * M4 additions stay read-only-or-DB-only by design (project detection,
 * package-manager detection, trust decisions, terminal/dev-process
 * bookkeeping): real process spawning (git clone, npm install, dev
 * servers, PTY shells) never happens inside this worker, whose only job
 * per ADR-003 is owning the database — see project-handlers.ts and
 * terminal-worker.ts for where that real work happens.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  addProjectInputSchema,
  createWorkspaceInputSchema,
  detectPackageManagerInputSchema,
  detectProjectInputSchema,
  inspectFolderInputSchema,
  projectListInputSchema,
  projectTrustDecisionInputSchema,
  workspaceActivateInputSchema,
  type DevProcessInfo,
  type PackageManagerDetection,
  type Project,
  type ProjectDetectionReport,
  type ProjectInspection,
  type TerminalSessionInfo,
  type Workspace,
  type WorkspaceSummary,
} from '@space/contracts';
import { activityEventFromOperation } from '@space/activity';
import { applyTrustDecision } from '@space/domain';
import { detectPackageManager, detectProject, detectedTypesFromReport, nodeProjectDetectionFs } from '@space/environment';
import {
  withReceipt,
  type AgentStandingPermissionRow,
  type AutomationRow,
  type AutomationRunRow,
  type DevProcessRow,
  type OperationRisk,
  type OperationRow,
  type ProjectRow,
  type ReceiptContext,
  type SecretRefRow,
  type ServiceConnectionRow,
  type Storage,
  type TerminalSessionRow,
  type WorkspaceRow,
} from '@space/storage';
import type { StorageMethod, StorageRequest } from './storage-protocol';

/**
 * The single hook point that turns a completed Operation receipt into an
 * activity event (spec 17.1 ACT-001), so every call site that already
 * writes a receipt gets activity recording "for free" — see
 * `@space/activity`'s `activityEventFromOperation` for the type mapping.
 * A no-op for operation types with no activity mapping.
 */
function recordActivityForOperation(storage: Storage, operation: OperationRow, subjectRef: string | null = null): void {
  const event = activityEventFromOperation({
    type: operation.type,
    workspaceId: operation.workspaceId,
    projectId: operation.projectId,
    humanSummary: operation.humanSummary,
    endedAt: operation.endedAt,
    state: operation.state,
    subjectRef,
  });
  if (event) {
    storage.activity.record(event);
  }
}

async function withReceiptAndActivity<T>(
  storage: Storage,
  context: ReceiptContext,
  action: () => Promise<T> | T,
  subjectRef: string | null = null,
): Promise<{ result: T; operation: OperationRow }> {
  const receipted = await withReceipt(storage.operations, context, action);
  recordActivityForOperation(storage, receipted.operation, subjectRef);
  return receipted;
}

function toWorkspaceSummary(row: WorkspaceRow): WorkspaceSummary {
  return { id: row.id, name: row.name, iconToken: row.iconToken, active: row.active };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...toWorkspaceSummary(row),
    defaultProjectDirectory: row.defaultProjectDirectory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    canonicalPath: row.canonicalPath,
    filesystemIdentity: row.filesystemIdentity,
    repositoryRoot: row.repositoryRoot,
    trustState: row.trustState,
    detectedTypes: row.detectedTypes,
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTerminalSessionInfo(row: TerminalSessionRow): TerminalSessionInfo | null {
  if (row.pid === null) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    shell: row.shell,
    cwd: row.cwd,
    pid: row.pid,
    state: row.state,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    exitCode: row.exitCode,
    lastOutputAt: row.lastOutputAt,
  };
}

function toDevProcessInfo(row: DevProcessRow): DevProcessInfo {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    commandDisplay: row.commandDisplay,
    pid: row.pid,
    state: row.state,
    detectedUrl: row.detectedUrl,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    exitCode: row.exitCode,
  };
}

function statSafe(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function inspectFolder(storage: Storage, rawPath: string): ProjectInspection {
  const canonicalPath = path.resolve(rawPath);
  const stat = statSafe(canonicalPath);
  const isDirectory = stat?.isDirectory() ?? false;
  const isGitRepository = isDirectory && fs.existsSync(path.join(canonicalPath, '.git'));
  const existing = storage.projects.findByPath(canonicalPath)[0] ?? null;
  return {
    path: canonicalPath,
    exists: stat !== null,
    isDirectory,
    isGitRepository,
    alreadyRegisteredInWorkspaceId: existing?.workspaceId ?? null,
  };
}

async function detectProjectTypes(canonicalPath: string): Promise<string[]> {
  const report = await detectProject(canonicalPath, nodeProjectDetectionFs);
  return detectedTypesFromReport(report);
}

async function addProject(
  storage: Storage,
  input: { workspaceId: string; canonicalPath: string; name?: string | undefined },
): Promise<Project> {
  const canonicalPath = path.resolve(input.canonicalPath);
  const stat = statSafe(canonicalPath);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`"${canonicalPath}" is not an accessible directory`);
  }
  const isGitRepository = fs.existsSync(path.join(canonicalPath, '.git'));
  const name = input.name?.trim() || path.basename(canonicalPath);
  const now = new Date().toISOString();
  const detectedTypes = await detectProjectTypes(canonicalPath);

  const { result } = await withReceiptAndActivity(
    storage,
    {
      workspaceId: input.workspaceId,
      projectId: null,
      type: 'project.add',
      risk: 'local-reversible',
      humanSummary: `Add project "${name}"`,
    },
    () =>
      storage.projects.create({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name,
        canonicalPath,
        filesystemIdentity: `${stat.dev}:${stat.ino}`,
        repositoryRoot: isGitRepository ? canonicalPath : null,
        detectedTypes,
        createdAt: now,
        updatedAt: now,
      }),
  );
  return toProject(result);
}

function requireProject(storage: Storage, id: string): ProjectRow {
  const project = storage.projects.findById(id);
  if (!project) {
    throw new Error(`Unknown project: ${id}`);
  }
  return project;
}

async function trustDecision(
  storage: Storage,
  input: { projectId: string; decision: 'allow-once' | 'trust-this-project' | 'keep-untrusted' },
): Promise<Project> {
  const project = requireProject(storage, input.projectId);
  const nextState = applyTrustDecision(project.trustState, input.decision);
  const now = new Date().toISOString();

  const { result } = await withReceipt(
    storage.operations,
    {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'project.trustDecision',
      risk: 'local-reversible',
      humanSummary: `Trust decision "${input.decision}" for project "${project.name}"`,
    },
    () =>
      nextState === project.trustState
        ? project
        : storage.projects.updateTrustState(project.id, nextState, now),
  );
  return toProject(result);
}

const recordSessionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  shell: z.string().min(1),
  cwd: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
});

const recordOutputSchema = z.object({
  sessionId: z.string().min(1),
  lastOutputAt: z.string().min(1),
});

const markExitedSchema = z.object({
  sessionId: z.string().min(1),
  exitCode: z.number().int().nullable(),
  endedAt: z.string().min(1),
});

const terminalListSchema = z.object({ workspaceId: z.string().min(1) });

const devProcessRecordStartSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  commandDisplay: z.string().min(1),
  cwd: z.string().min(1),
  pid: z.number().int().positive().nullable(),
  startedAt: z.string().min(1),
});

const devProcessSetUrlSchema = z.object({ id: z.string().min(1), url: z.string().min(1) });

const devProcessMarkStoppedSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['stopped', 'crashed']),
  exitCode: z.number().int().nullable(),
  endedAt: z.string().min(1),
});

const devProcessListSchema = z.object({ projectId: z.string().min(1) });

const activityListRangeSchema = z.object({
  workspaceId: z.string().min(1),
  fromInclusive: z.string().min(1),
  toInclusive: z.string().min(1),
});

const operationRecordCompletedSchema = z.object({
  workspaceId: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  type: z.string().min(1),
  risk: z.enum(['observe', 'local-reversible', 'remote', 'destructive']),
  humanSummary: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  state: z.enum(['succeeded', 'failed', 'cancelled', 'partially_succeeded']),
  exitCode: z.number().int().nullable(),
  partialState: z.unknown().optional(),
  /** e.g. a commit SHA or branch name — spec 17.3's "links to the relevant commit". */
  subjectRef: z.string().min(1).nullable().optional(),
});

// ---------------------------------------------------------------------------
// M6: GitHub credential bookkeeping (spec 23.2.5/23.2.6). Reference-only —
// the secret value itself never appears in any of these payloads; it lives
// only in the OS credential store behind @space/security's
// CredentialStorePort, resolved by github-handlers.ts, not this worker.
// ---------------------------------------------------------------------------

const githubSecretRefUpsertSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  provider: z.string().min(1),
  serviceName: z.string().min(1),
  accountKey: z.string().min(1),
  createdAt: z.string().min(1),
});

const githubSecretRefDeleteSchema = z.object({ id: z.string().min(1) });

const githubConnectionUpsertSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  adapterId: z.string().min(1),
  host: z.string().min(1),
  accountLabel: z.string().min(1).nullable(),
  profileLabel: z.string().min(1).nullable(),
  secretRefId: z.string().min(1).nullable(),
  state: z.enum(['connected', 'disconnected', 'error']),
  lastVerifiedAt: z.string().min(1).nullable(),
});

const githubConnectionGetSchema = z.object({ workspaceId: z.string().min(1), adapterId: z.string().min(1), host: z.string().min(1) });
const githubConnectionListSchema = z.object({ workspaceId: z.string().min(1) });

// ---------------------------------------------------------------------------
// M7: agent standing permissions (spec 19.2.3/19.2.4) — narrow, revocable
// grants; a row here can only ever satisfy the confirmation gate for
// remote-risk agent actions (@space/domain's assertAgentActionConfirmed
// never lets one substitute for a destructive action's confirmation).
// ---------------------------------------------------------------------------

const agentPermissionGrantSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  actionType: z.string().min(1),
  grantedAt: z.string().min(1),
});
const agentPermissionRevokeSchema = z.object({ id: z.string().min(1), revokedAt: z.string().min(1) });
const agentPermissionListSchema = z.object({ workspaceId: z.string().min(1) });
const agentPermissionFindActiveGrantSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  actionType: z.string().min(1),
});

// ---------------------------------------------------------------------------
// M8: automations (spec section 18) — this worker only ever owns the
// database (ADR-003); the engine, trigger matching, and dispatch to real
// capabilities live in automation-handlers.ts, exactly like git/github/
// project handlers.
// ---------------------------------------------------------------------------

const automationCreateSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  name: z.string().min(1),
  trigger: z.unknown(),
  conditions: z.array(z.unknown()),
  actions: z.array(z.unknown()),
  createdAt: z.string().min(1),
});
const automationListSchema = z.object({ workspaceId: z.string().min(1) });
const automationSetEnabledSchema = z.object({ id: z.string().min(1), enabled: z.boolean(), updatedAt: z.string().min(1) });
const automationSetLastExecutionIdSchema = z.object({ id: z.string().min(1), lastExecutionId: z.string().min(1), updatedAt: z.string().min(1) });
const automationDeleteSchema = z.object({ id: z.string().min(1) });

const automationRunStartSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  triggerType: z.string().min(1),
  triggerEvent: z.unknown(),
  startedAt: z.string().min(1),
  operationId: z.string().min(1).nullable().optional(),
});
const automationRunCompleteSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['succeeded', 'failed', 'skipped-disabled', 'skipped-conditions']),
  endedAt: z.string().min(1),
  failureReason: z.string().nullable().optional(),
  attempts: z.number().int().min(0),
});
const automationRunListByAutomationSchema = z.object({ automationId: z.string().min(1), limit: z.number().int().min(1).optional() });
const automationSettingsIsAllEnabledSchema = z.object({ workspaceId: z.string().min(1) });
const automationSettingsSetAllEnabledSchema = z.object({ workspaceId: z.string().min(1), enabled: z.boolean(), updatedAt: z.string().min(1) });

// M8: app-level settings (spec 29.2 telemetry opt-in) — not workspace-scoped.
const appSettingsSetTelemetryEnabledSchema = z.object({ enabled: z.boolean(), updatedAt: z.string().min(1) });

export async function handleStorageRequest(storage: Storage, request: StorageRequest): Promise<unknown> {
  const method = request.method as StorageMethod;
  switch (method) {
    case 'workspace.list':
      return storage.workspaces.list().map(toWorkspaceSummary);

    case 'workspace.create': {
      const input = createWorkspaceInputSchema.parse(request.payload);
      const now = new Date().toISOString();
      const { result, operation } = await withReceipt(
        storage.operations,
        {
          workspaceId: null,
          projectId: null,
          type: 'workspace.create',
          risk: 'local-reversible',
          humanSummary: `Create workspace "${input.name}"`,
        },
        () =>
          storage.workspaces.create({
            id: randomUUID(),
            name: input.name,
            iconToken: input.iconToken ?? null,
            defaultProjectDirectory: input.defaultProjectDirectory ?? null,
            createdAt: now,
            updatedAt: now,
          }),
      );
      // The one exception to recordActivityForOperation's generic hook: the
      // receipt is necessarily recorded with workspaceId: null (the
      // workspace doesn't exist until the action inside it completes), so
      // there is no operation.workspaceId to derive an event from — the
      // newly created workspace's own id has to be supplied explicitly.
      storage.activity.record({
        workspaceId: result.id,
        projectId: null,
        eventType: 'workspace-created',
        occurredAt: operation.endedAt ?? now,
        subjectRef: null,
        summary: operation.humanSummary,
        weight: 1,
        metadata: null,
      });
      return toWorkspace(result);
    }

    case 'workspace.activate': {
      const input = workspaceActivateInputSchema.parse(request.payload);
      const now = new Date().toISOString();
      await withReceiptAndActivity(
        storage,
        {
          workspaceId: input.workspaceId,
          projectId: null,
          type: 'workspace.activate',
          risk: 'local-reversible',
          humanSummary: 'Switch active workspace',
        },
        () => storage.workspaces.activate(input.workspaceId, now),
      );
      return undefined;
    }

    case 'project.list': {
      const input = projectListInputSchema.parse(request.payload);
      return storage.projects.listByWorkspace(input.workspaceId).map(toProject);
    }

    case 'project.inspectFolder': {
      const input = inspectFolderInputSchema.parse(request.payload);
      return inspectFolder(storage, input.path);
    }

    case 'project.add': {
      const input = addProjectInputSchema.parse(request.payload);
      return addProject(storage, input);
    }

    case 'project.get': {
      const input = z.object({ projectId: z.string().min(1) }).parse(request.payload);
      return toProject(requireProject(storage, input.projectId));
    }

    case 'project.detect': {
      const input = detectProjectInputSchema.parse(request.payload);
      const canonicalPath = path.resolve(input.canonicalPath);
      const report: ProjectDetectionReport = await detectProject(canonicalPath, nodeProjectDetectionFs);
      return report;
    }

    case 'project.detectPackageManager': {
      const input = detectPackageManagerInputSchema.parse(request.payload);
      const canonicalPath = path.resolve(input.canonicalPath);
      const detection: PackageManagerDetection = await detectPackageManager(canonicalPath, nodeProjectDetectionFs);
      return detection;
    }

    case 'project.trustDecision': {
      const input = projectTrustDecisionInputSchema.parse(request.payload);
      return trustDecision(storage, input);
    }

    case 'terminal.recordSession': {
      const input = recordSessionSchema.parse(request.payload);
      const row = storage.terminalSessions.create(input);
      const info = toTerminalSessionInfo(row);
      if (!info) {
        throw new Error(`Terminal session ${row.id} was recorded without a pid`);
      }
      // No Operation receipt exists for a terminal session (it's a stream,
      // not a single request/response, spec 22.1) — record the "Terminal
      // session" activity category (spec 17.1) directly from this real,
      // observed session start instead.
      storage.activity.record({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        eventType: 'terminal-session',
        occurredAt: input.startedAt,
        subjectRef: input.id,
        summary: `Open terminal session in "${input.cwd}"`,
        weight: 0.5,
        metadata: null,
      });
      return info;
    }

    case 'terminal.recordOutput': {
      const input = recordOutputSchema.parse(request.payload);
      storage.terminalSessions.recordOutput(input.sessionId, input.lastOutputAt);
      return undefined;
    }

    case 'terminal.markExited': {
      const input = markExitedSchema.parse(request.payload);
      const row = storage.terminalSessions.markExited(input.sessionId, input.exitCode, input.endedAt);
      return toTerminalSessionInfo(row);
    }

    case 'terminal.list': {
      const input = terminalListSchema.parse(request.payload);
      return storage.terminalSessions
        .listByWorkspace(input.workspaceId)
        .map(toTerminalSessionInfo)
        .filter((info): info is TerminalSessionInfo => info !== null);
    }

    case 'devProcess.recordStart': {
      const input = devProcessRecordStartSchema.parse(request.payload);
      const project = requireProject(storage, input.projectId);
      const { result } = await withReceiptAndActivity(
        storage,
        {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: 'project.devServer.start',
          risk: 'local-reversible',
          humanSummary: `Start development server for "${project.name}"`,
        },
        () =>
          storage.devProcesses.create({
            id: input.id,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            commandDisplay: input.commandDisplay,
            cwd: input.cwd,
            pid: input.pid,
            startedAt: input.startedAt,
            operationId: null,
          }),
      );
      return toDevProcessInfo(result);
    }

    case 'devProcess.setDetectedUrl': {
      const input = devProcessSetUrlSchema.parse(request.payload);
      return toDevProcessInfo(storage.devProcesses.setDetectedUrl(input.id, input.url));
    }

    case 'devProcess.markStopped': {
      const input = devProcessMarkStoppedSchema.parse(request.payload);
      const existing = storage.devProcesses.findById(input.id);
      const { result } = await withReceiptAndActivity(
        storage,
        {
          workspaceId: existing?.workspaceId ?? null,
          projectId: existing?.projectId ?? null,
          type: 'project.devServer.stop',
          risk: 'local-reversible',
          humanSummary: 'Stop development server',
        },
        () => storage.devProcesses.markStopped(input.id, input.state, input.exitCode, input.endedAt),
      );
      return toDevProcessInfo(result);
    }

    case 'devProcess.list': {
      const input = devProcessListSchema.parse(request.payload);
      return storage.devProcesses.listByProject(input.projectId).map(toDevProcessInfo);
    }

    case 'operation.recordCompleted': {
      const input = operationRecordCompletedSchema.parse(request.payload);
      const id = randomUUID();
      storage.operations.start({
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        type: input.type,
        risk: input.risk as OperationRisk,
        humanSummary: input.humanSummary,
        startedAt: input.startedAt,
      });
      const completed = storage.operations.complete(id, {
        state: input.state,
        endedAt: input.endedAt,
        exitCode: input.exitCode,
        partialState: input.partialState,
      });
      recordActivityForOperation(storage, completed, input.subjectRef ?? null);
      return undefined;
    }

    case 'activity.listRange': {
      const input = activityListRangeSchema.parse(request.payload);
      return storage.activity.listByWorkspaceInRange(input.workspaceId, {
        fromInclusive: input.fromInclusive,
        toInclusive: input.toInclusive,
      });
    }

    case 'system.reconcileOrphans': {
      const now = new Date().toISOString();
      const terminalSessions = storage.terminalSessions.reconcileOrphanedSessions(now);
      const devProcesses = storage.devProcesses.reconcileOrphanedProcesses(now);
      return { terminalSessions, devProcesses };
    }

    case 'githubSecretRef.upsert': {
      const input = githubSecretRefUpsertSchema.parse(request.payload);
      const row: SecretRefRow = storage.secretRefs.create(input);
      return row;
    }

    case 'githubSecretRef.delete': {
      const input = githubSecretRefDeleteSchema.parse(request.payload);
      storage.secretRefs.delete(input.id);
      return undefined;
    }

    case 'githubConnection.upsert': {
      const input = githubConnectionUpsertSchema.parse(request.payload);
      const row: ServiceConnectionRow = storage.serviceConnections.upsert(input);
      return row;
    }

    case 'githubConnection.get': {
      const input = githubConnectionGetSchema.parse(request.payload);
      return storage.serviceConnections.findByWorkspaceAdapterHost(input.workspaceId, input.adapterId, input.host);
    }

    case 'githubConnection.list': {
      const input = githubConnectionListSchema.parse(request.payload);
      return storage.serviceConnections.listByWorkspace(input.workspaceId);
    }

    case 'agentPermission.grant': {
      const input = agentPermissionGrantSchema.parse(request.payload);
      const row: AgentStandingPermissionRow = storage.agentPermissions.grant(input);
      return row;
    }

    case 'agentPermission.revoke': {
      const input = agentPermissionRevokeSchema.parse(request.payload);
      storage.agentPermissions.revoke(input.id, input.revokedAt);
      return undefined;
    }

    case 'agentPermission.list': {
      const input = agentPermissionListSchema.parse(request.payload);
      return storage.agentPermissions.listByWorkspace(input.workspaceId);
    }

    case 'agentPermission.findActiveGrant': {
      const input = agentPermissionFindActiveGrantSchema.parse(request.payload);
      return storage.agentPermissions.findActiveGrant(input.workspaceId, input.projectId, input.actionType);
    }

    case 'automation.create': {
      const input = automationCreateSchema.parse(request.payload);
      const row: AutomationRow = storage.automations.create(input);
      return row;
    }

    case 'automation.list': {
      const input = automationListSchema.parse(request.payload);
      return storage.automations.listByWorkspace(input.workspaceId);
    }

    case 'automation.setEnabled': {
      const input = automationSetEnabledSchema.parse(request.payload);
      const row: AutomationRow = storage.automations.setEnabled(input.id, input.enabled, input.updatedAt);
      return row;
    }

    case 'automation.setLastExecutionId': {
      const input = automationSetLastExecutionIdSchema.parse(request.payload);
      storage.automations.setLastExecutionId(input.id, input.lastExecutionId, input.updatedAt);
      return undefined;
    }

    case 'automation.delete': {
      const input = automationDeleteSchema.parse(request.payload);
      storage.automations.delete(input.id);
      return undefined;
    }

    case 'automationRun.start': {
      const input = automationRunStartSchema.parse(request.payload);
      const row: AutomationRunRow = storage.automationRuns.start({
        id: input.id,
        automationId: input.automationId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        triggerType: input.triggerType,
        triggerEvent: input.triggerEvent,
        startedAt: input.startedAt,
        operationId: input.operationId ?? null,
      });
      return row;
    }

    case 'automationRun.complete': {
      const input = automationRunCompleteSchema.parse(request.payload);
      const row: AutomationRunRow = storage.automationRuns.complete(input.id, {
        state: input.state,
        endedAt: input.endedAt,
        failureReason: input.failureReason ?? null,
        attempts: input.attempts,
      });
      return row;
    }

    case 'automationRun.listByAutomation': {
      const input = automationRunListByAutomationSchema.parse(request.payload);
      return storage.automationRuns.listByAutomation(input.automationId, input.limit);
    }

    case 'automationSettings.isAllEnabled': {
      const input = automationSettingsIsAllEnabledSchema.parse(request.payload);
      return storage.automationSettings.isAllEnabled(input.workspaceId);
    }

    case 'automationSettings.setAllEnabled': {
      const input = automationSettingsSetAllEnabledSchema.parse(request.payload);
      storage.automationSettings.setAllEnabled(input.workspaceId, input.enabled, input.updatedAt);
      return undefined;
    }

    case 'appSettings.isTelemetryEnabled': {
      return storage.appSettings.isTelemetryEnabled();
    }

    case 'appSettings.setTelemetryEnabled': {
      const input = appSettingsSetTelemetryEnabledSchema.parse(request.payload);
      storage.appSettings.setTelemetryEnabled(input.enabled, input.updatedAt);
      return undefined;
    }

    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown storage method: ${String(exhaustive)}`);
    }
  }
}
