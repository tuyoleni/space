/**
 * Versioned migration runner (spec section 23.3, ADR-003).
 *
 * Rules: migrations run before any repository is used; a backup of the
 * database file is taken before applying any pending migration; a failed
 * migration rolls back and throws, which the caller must treat as blocking
 * further mutation until resolved — there is no automatic downgrade.
 */
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { MIGRATION_0001_INIT } from './schema/0001_init';
import { MIGRATION_0002_BOOTSTRAP } from './schema/0002_bootstrap';
import { MIGRATION_0003_TERMINAL_AND_DEV_PROCESS } from './schema/0003_terminal_and_dev_process';
import { MIGRATION_0004_ACTIVITY } from './schema/0004_activity';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: MIGRATION_0001_INIT },
  { version: 2, name: 'bootstrap', sql: MIGRATION_0002_BOOTSTRAP },
  { version: 3, name: 'terminal_and_dev_process', sql: MIGRATION_0003_TERMINAL_AND_DEV_PROCESS },
  { version: 4, name: 'activity', sql: MIGRATION_0004_ACTIVITY },
];

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function appliedVersions(db: Database.Database): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((row) => row.version));
}

/**
 * Copies the database file (and its WAL/SHM siblings, if present) to
 * `<path>.backup-<timestamp>` before mutating the schema.
 */
export function backupDatabaseFile(dbPath: string): string | null {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) {
    return null;
  }
  const backupPath = `${dbPath}.backup-${Date.now()}`;
  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.copyFileSync(sidecar, `${backupPath}${suffix}`);
    }
  }
  return backupPath;
}

/**
 * Applies every migration with `version` greater than the highest applied
 * version, in order, inside a single transaction per migration. Throws
 * (and leaves the schema at the last successfully applied version) if any
 * migration fails.
 */
export function runMigrations(
  db: Database.Database,
  dbPath: string,
  migrations: readonly Migration[] = MIGRATIONS,
): { appliedCount: number; backupPath: string | null } {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const pending = migrations
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return { appliedCount: 0, backupPath: null };
  }

  const backupPath = backupDatabaseFile(dbPath);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
    });
    try {
      apply();
    } catch (error) {
      throw new Error(
        `Migration ${migration.version} ("${migration.name}") failed and was rolled back: ${String(error)}`,
      );
    }
  }

  return { appliedCount: pending.length, backupPath };
}
