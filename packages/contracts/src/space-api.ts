import type {
  AddProjectInput,
  CloneProjectInput,
  CreateProjectFromTemplateInput,
  CreateTerminalInput,
  CreateWorkspaceInput,
  DetectPackageManagerInput,
  DetectProjectInput,
  DevProcessInfo,
  InspectFolderInput,
  InstallDependenciesInput,
  InstallDependenciesResult,
  PackageManagerDetection,
  Project,
  ProjectDetectionReport,
  ProjectInspection,
  ProjectTemplateSummary,
  ProjectTrustDecisionInput,
  StartDevServerInput,
  StopDevServerInput,
  TerminalDisposeInput,
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionInfo,
  TerminalWriteInput,
  Unsubscribe,
  Workspace,
  WorkspaceSummary,
} from './types';

/**
 * The full renderer-facing API surface (spec section 22.2). Nothing here
 * resembles `runCommand(command: string)`: every method is a narrow,
 * validated operation on a named domain. `terminal.subscribe` mirrors the
 * spec's `operation.subscribe(id, listener): Unsubscribe` shape (section
 * 22.2) because terminal output is a stream, not a single response.
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

    /** PRJ-002: read-only, confidence-scored detection facts. */
    detect(input: DetectProjectInput): Promise<ProjectDetectionReport>;
    /** PRJ-005: lockfile-based package manager resolution. */
    detectPackageManager(input: DetectPackageManagerInput): Promise<PackageManagerDetection>;
    /** PRJ-003/ADR-006: apply a trust decision (allow-once/trust-this-project/keep-untrusted). */
    trustDecision(input: ProjectTrustDecisionInput): Promise<Project>;
    /** PRJ-004: template metadata shown before any creation command runs. */
    listTemplates(): Promise<ProjectTemplateSummary[]>;
    createFromTemplate(input: CreateProjectFromTemplateInput): Promise<Project>;
    /** PRJ-001/004 clone flow, via @space/git-engine. */
    clone(input: CloneProjectInput): Promise<Project>;
    /** PRJ-005: gated by project trust unless `allowOnce` is set. */
    installDependencies(input: InstallDependenciesInput): Promise<InstallDependenciesResult>;
    /** Opens the native folder picker for a create/clone destination parent. */
    pickParentDirectory(): Promise<string | null>;
  };
  readonly terminal: {
    /** TERM-002: permanently binds the session to workspaceId/projectId at creation. */
    create(input: CreateTerminalInput): Promise<TerminalSessionInfo>;
    write(input: TerminalWriteInput): Promise<void>;
    resize(input: TerminalResizeInput): Promise<void>;
    dispose(input: TerminalDisposeInput): Promise<void>;
    list(workspaceId: string): Promise<TerminalSessionInfo[]>;
    /** Mirrors spec 22.2's operation.subscribe(id, listener): Unsubscribe. */
    subscribe(sessionId: string, listener: (event: TerminalEvent) => void): Unsubscribe;
  };
  readonly devServer: {
    /** PRJ-006: gated by project trust unless `allowOnce` is set; launched through the Workspace Process Runner. */
    start(input: StartDevServerInput): Promise<DevProcessInfo>;
    stop(input: StopDevServerInput): Promise<void>;
    list(projectId: string): Promise<DevProcessInfo[]>;
  };
}
