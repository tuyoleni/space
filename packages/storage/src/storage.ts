import type Database from 'better-sqlite3';
import { openDatabase } from './database';
import { ActivityRepository } from './repositories/activity-repository';
import { BootstrapRepository } from './repositories/bootstrap-repository';
import { DevProcessRepository } from './repositories/dev-process-repository';
import { OperationRepository } from './repositories/operation-repository';
import { ProjectRepository } from './repositories/project-repository';
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
    close: () => db.close(),
  };
}
