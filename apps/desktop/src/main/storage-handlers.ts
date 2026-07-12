/**
 * Per-method logic for the storage worker (spec sections 23, 33). Every
 * mutation is wrapped in withReceipt so it leaves a durable Operation row;
 * every input is parsed through the shared zod schemas before it touches
 * a repository (spec section 22.1: no channel accepts unvalidated input).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  addProjectInputSchema,
  createWorkspaceInputSchema,
  inspectFolderInputSchema,
  projectListInputSchema,
  workspaceActivateInputSchema,
  type Project,
  type ProjectInspection,
  type Workspace,
  type WorkspaceSummary,
} from '@space/contracts';
import { withReceipt, type ProjectRow, type Storage, type WorkspaceRow } from '@space/storage';
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

/** Deliberately minimal: full confidence-scored detection is a Phase 3 deliverable. */
function detectProjectTypes(canonicalPath: string): string[] {
  const detected: string[] = [];
  if (fs.existsSync(path.join(canonicalPath, 'package.json'))) {
    detected.push('node');
  }
  return detected;
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
        detectedTypes: detectProjectTypes(canonicalPath),
        createdAt: now,
        updatedAt: now,
      }),
  );
  return toProject(result);
}

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

    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown storage method: ${String(exhaustive)}`);
    }
  }
}
