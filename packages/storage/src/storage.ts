import type Database from 'better-sqlite3';
import { openDatabase } from './database';
import { ActivityRepository } from './repositories/activity-repository';
import { AgentPermissionRepository } from './repositories/agent-permission-repository';
import { AutomationRepository } from './repositories/automation-repository';
import { AutomationRunRepository } from './repositories/automation-run-repository';
import { AutomationSettingsRepository } from './repositories/automation-settings-repository';
import { BootstrapRepository } from './repositories/bootstrap-repository';
import { DevProcessRepository } from './repositories/dev-process-repository';
import { OperationRepository } from './repositories/operation-repository';
import { ProjectRepository } from './repositories/project-repository';
import { SecretRefRepository } from './repositories/secret-ref-repository';
import { ServiceConnectionRepository } from './repositories/service-connection-repository';
import { TerminalSessionRepository } from './repositories/terminal-session-repository';
import { WorkspaceRepository } from './repositories/workspace-repository';

export interface Storage {
  readonly db: Database.Database;
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly operations: OperationRepository;
  readonly bootstrap: BootstrapRepository;
  readonly terminalSessions: TerminalSessionRepository;
  readonly devProcesses: DevProcessRepository;
  readonly activity: ActivityRepository;
  readonly secretRefs: SecretRefRepository;
  readonly serviceConnections: ServiceConnectionRepository;
  readonly agentPermissions: AgentPermissionRepository;
  readonly automations: AutomationRepository;
  readonly automationRuns: AutomationRunRepository;
  readonly automationSettings: AutomationSettingsRepository;
  close(): void;
}

/**
 * Opens the database at `dbPath`, runs migrations, and returns the
 * repositories built on top of it. Callers outside this worker boundary
 * must never construct `Database` directly (ADR-003).
 */
export function createStorage(dbPath: string): Storage {
  const db = openDatabase(dbPath);
  return {
    db,
    workspaces: new WorkspaceRepository(db),
    projects: new ProjectRepository(db),
    operations: new OperationRepository(db),
    bootstrap: new BootstrapRepository(db),
    terminalSessions: new TerminalSessionRepository(db),
    devProcesses: new DevProcessRepository(db),
    activity: new ActivityRepository(db),
    secretRefs: new SecretRefRepository(db),
    serviceConnections: new ServiceConnectionRepository(db),
    agentPermissions: new AgentPermissionRepository(db),
    automations: new AutomationRepository(db),
    automationRuns: new AutomationRunRepository(db),
    automationSettings: new AutomationSettingsRepository(db),
    close: () => db.close(),
  };
}
