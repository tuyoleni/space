import type {
  AddProjectInput,
  CreateWorkspaceInput,
  InspectFolderInput,
  Project,
  ProjectInspection,
  Workspace,
  WorkspaceSummary,
} from './types';

/**
 * The full renderer-facing API surface (spec section 22.2). Nothing here
 * resembles `runCommand(command: string)`: every method is a narrow,
 * validated operation on a named domain.
 */
export interface SpaceAPI {
  readonly workspace: {
    list(): Promise<WorkspaceSummary[]>;
    create(input: CreateWorkspaceInput): Promise<Workspace>;
    activate(workspaceId: string): Promise<void>;
  };
  readonly project: {
    list(workspaceId: string): Promise<Project[]>;
    inspectFolder(input: InspectFolderInput): Promise<ProjectInspection>;
    /** Opens the native folder picker; returns null if the user cancels. */
    pickFolder(): Promise<string | null>;
    add(input: AddProjectInput): Promise<Project>;
  };
}
