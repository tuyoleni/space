import Database from 'better-sqlite3';
import { runMigrations } from './migrations';

/**
 * Opens the database, enables WAL mode and foreign keys (proven safe by
 * the P0-A spike), and runs any pending migrations before returning. Must
 * only ever be called from the dedicated storage worker process
 * (ADR-003) — never from the Electron main thread or the renderer.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, dbPath);
  return db;
}
