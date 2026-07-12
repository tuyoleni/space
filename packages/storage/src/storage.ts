import type Database from 'better-sqlite3';
import { openDatabase } from './database';
import { OperationRepository } from './repositories/operation-repository';
import { ProjectRepository } from './repositories/project-repository';
import { WorkspaceRepository } from './repositories/workspace-repository';

export interface Storage {
  readonly db: Database.Database;
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly operations: OperationRepository;
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
    close: () => db.close(),
  };
}
