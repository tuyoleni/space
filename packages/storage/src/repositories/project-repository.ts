import type Database from 'better-sqlite3';

export type ProjectTrustState = 'untrusted' | 'trusted';

export interface ProjectRow {
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

export interface NewProjectRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly canonicalPath: string;
  readonly filesystemIdentity: string | null;
  readonly repositoryRoot: string | null;
  readonly detectedTypes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SqliteProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  canonical_path: string;
  filesystem_identity: string | null;
  repository_root: string | null;
  trust_state: ProjectTrustState;
  detected_type_json: string;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromSqlite(row: SqliteProjectRow): ProjectRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    canonicalPath: row.canonical_path,
    filesystemIdentity: row.filesystem_identity,
    repositoryRoot: row.repository_root,
    trustState: row.trust_state,
    detectedTypes: JSON.parse(row.detected_type_json) as string[],
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pure data access over the `projects` table (spec section 23.2.2). */
export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  listByWorkspace(workspaceId: string): ProjectRow[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as SqliteProjectRow[];
    return rows.map(fromSqlite);
  }

  findById(id: string): ProjectRow | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | SqliteProjectRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  /** Used for WS-005 ownership checks: is this path already registered anywhere? */
  findByPath(canonicalPath: string): ProjectRow[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE canonical_path = ?')
      .all(canonicalPath) as SqliteProjectRow[];
    return rows.map(fromSqlite);
  }

  create(input: NewProjectRow): ProjectRow {
    this.db
      .prepare(
        `INSERT INTO projects
           (id, workspace_id, name, canonical_path, filesystem_identity, repository_root,
            trust_state, detected_type_json, remote_json, last_opened_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'untrusted', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.name,
        input.canonicalPath,
        input.filesystemIdentity,
        input.repositoryRoot,
        JSON.stringify(input.detectedTypes),
        input.createdAt,
        input.updatedAt,
      );
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`Project ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  /** PRJ-003/ADR-006: the only place `trust_state` is ever written after creation. */
  updateTrustState(id: string, trustState: ProjectTrustState, updatedAt: string): ProjectRow {
    this.db.prepare('UPDATE projects SET trust_state = ?, updated_at = ? WHERE id = ?').run(
      trustState,
      updatedAt,
      id,
    );
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Project ${id} vanished while updating trust state`);
    }
    return updated;
  }

  /** PRJ-002: re-detection refreshes the flattened `detected_type_json` snapshot on the row. */
  updateDetectedTypes(id: string, detectedTypes: readonly string[], updatedAt: string): ProjectRow {
    this.db
      .prepare('UPDATE projects SET detected_type_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(detectedTypes), updatedAt, id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Project ${id} vanished while updating detected types`);
    }
    return updated;
  }

  /**
   * Unregisters a project from its workspace. This removes Space's *record*
   * of the project and nothing else — the directory, its Git repository, and
   * every file in it are left exactly as they are. Space orchestrates real
   * tools rather than owning the user's code, so "remove" here can never
   * mean "delete from disk" (spec section 39's prohibition on destructive
   * shortcuts).
   *
   * Rows in other tables follow the foreign keys declared in the schema:
   * operations, activity events, and terminal sessions keep their history
   * with `project_id` set to NULL, while project-scoped automations, agent
   * permissions, and dev-process records cascade away with the project they
   * only made sense for.
   */
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  /** Set once a project transitions from "plain folder" to "real Git repository" — real `git init`, never guessed. */
  updateRepositoryRoot(id: string, repositoryRoot: string, updatedAt: string): ProjectRow {
    this.db.prepare('UPDATE projects SET repository_root = ?, updated_at = ? WHERE id = ?').run(
      repositoryRoot,
      updatedAt,
      id,
    );
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Project ${id} vanished while updating repository root`);
    }
    return updated;
  }
}
