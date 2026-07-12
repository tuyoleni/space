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
import { applyTrustDecision } from '@space/domain';
import { detectPackageManager, detectProject, detectedTypesFromReport, nodeProjectDetectionFs } from '@space/environment';
import type { OperationRisk } from '@space/storage';
import {
  withReceipt,
  type DevProcessRow,
  type ProjectRow,
  type Storage,
  type TerminalSessionRow,
  type WorkspaceRow,
} from '@space/storage';
import type { StorageMethod, StorageRequest } from './storage-protocol';

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

  const { result } = await withReceipt(
    storage.operations,
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
});

export async function handleStorageRequest(storage: Storage, request: StorageRequest): Promise<unknown> {
  const method = request.method as StorageMethod;
  switch (method) {
    case 'workspace.list':
      return storage.workspaces.list().map(toWorkspaceSummary);

    case 'workspace.create': {
      const input = createWorkspaceInputSchema.parse(request.payload);
      const now = new Date().toISOString();
      const { result } = await withReceipt(
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
      return toWorkspace(result);
    }

    case 'workspace.activate': {
      const input = workspaceActivateInputSchema.parse(request.payload);
      const now = new Date().toISOString();
      await withReceipt(
        storage.operations,
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
      const { result } = await withReceipt(
        storage.operations,
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
      const { result } = await withReceipt(
        storage.operations,
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
      storage.operations.complete(id, {
        state: input.state,
        endedAt: input.endedAt,
        exitCode: input.exitCode,
        partialState: input.partialState,
      });
      return undefined;
    }

    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown storage method: ${String(exhaustive)}`);
    }
  }
}
