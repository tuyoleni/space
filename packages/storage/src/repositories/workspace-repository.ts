import type Database from 'better-sqlite3';

export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly iconToken: string | null;
  readonly defaultProjectDirectory: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewWorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly iconToken: string | null;
  readonly defaultProjectDirectory: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SqliteWorkspaceRow {
  id: string;
  name: string;
  icon_token: string | null;
  default_project_directory: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function fromSqlite(row: SqliteWorkspaceRow): WorkspaceRow {
  return {
    id: row.id,
    name: row.name,
    iconToken: row.icon_token,
    defaultProjectDirectory: row.default_project_directory,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pure data access over the `workspaces` table (spec section 23.2.1). */
export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  list(): WorkspaceRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY created_at ASC')
      .all() as SqliteWorkspaceRow[];
    return rows.map(fromSqlite);
  }

  findById(id: string): WorkspaceRow | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | SqliteWorkspaceRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  create(input: NewWorkspaceRow): WorkspaceRow {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, icon_token, default_project_directory, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.iconToken,
        input.defaultProjectDirectory,
        input.createdAt,
        input.updatedAt,
      );
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Workspace ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  /**
   * Deactivates every other workspace and activates the target in one
   * transaction, so the "active workspace" is always well-defined
   * (WS-006 atomicity at the storage layer).
   */
  activate(id: string, updatedAt: string): WorkspaceRow {
    const activateTx = this.db.transaction(() => {
      const target = this.findById(id);
      if (!target) {
        throw new Error(`Cannot activate unknown workspace ${id}`);
      }
      this.db.prepare('UPDATE workspaces SET active = 0, updated_at = ? WHERE active = 1').run(updatedAt);
      this.db.prepare('UPDATE workspaces SET active = 1, updated_at = ? WHERE id = ?').run(updatedAt, id);
    });
    activateTx();
    const activated = this.findById(id);
    if (!activated) {
      throw new Error(`Workspace ${id} vanished during activation`);
    }
    return activated;
  }
}
