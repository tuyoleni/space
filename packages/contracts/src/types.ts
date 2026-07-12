/**
 * Shared domain types for the IPC contract (spec section 22, entities in
 * section 23.2). Field sets mirror the persisted columns exactly so the
 * renderer never sees data the storage layer cannot actually produce.
 */

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly iconToken: string | null;
  readonly active: boolean;
}

export interface Workspace extends WorkspaceSummary {
  readonly defaultProjectDirectory: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly iconToken?: string;
  readonly defaultProjectDirectory?: string;
}

export type ProjectTrustState = 'untrusted' | 'trusted';

export interface Project {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly canonicalPath: string;
  readonly filesystemIdentity: string | null;
  readonly repositoryRoot: string | null;
  readonly trustState: ProjectTrustState;
  readonly detectedTypes: readonly string[];
  readonly lastOpenedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddProjectInput {
  readonly workspaceId: string;
  readonly canonicalPath: string;
  /** Defaults to the path's base name when omitted. */
  readonly name?: string;
}

export interface InspectFolderInput {
  readonly path: string;
}

/**
 * Deliberately minimal: full confidence-scored detection (PRJ-002) is a
 * Phase 3 deliverable. This only answers what registration needs to know.
 */
export interface ProjectInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isGitRepository: boolean;
  readonly alreadyRegisteredInWorkspaceId: string | null;
}
