import type Database from 'better-sqlite3';

/** Pure data access over the `service_connections` table (spec 23.2.5). */
export type ServiceConnectionState = 'connected' | 'disconnected' | 'error';

export interface ServiceConnectionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly adapterId: string;
  readonly host: string;
  readonly accountLabel: string | null;
  readonly profileLabel: string | null;
  readonly secretRefId: string | null;
  readonly state: ServiceConnectionState;
  readonly lastVerifiedAt: string | null;
}

export interface NewServiceConnectionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly adapterId: string;
  readonly host: string;
  readonly accountLabel: string | null;
  readonly profileLabel: string | null;
  readonly secretRefId: string | null;
  readonly state: ServiceConnectionState;
  readonly lastVerifiedAt: string | null;
}

interface SqliteServiceConnectionRow {
  id: string;
  workspace_id: string;
  adapter_id: string;
  host: string;
  account_label: string | null;
  profile_label: string | null;
  secret_ref_id: string | null;
  state: string;
  last_verified_at: string | null;
}

function fromSqlite(row: SqliteServiceConnectionRow): ServiceConnectionRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    adapterId: row.adapter_id,
    host: row.host,
    accountLabel: row.account_label,
    profileLabel: row.profile_label,
    secretRefId: row.secret_ref_id,
    state: row.state as ServiceConnectionState,
    lastVerifiedAt: row.last_verified_at,
  };
}

export class ServiceConnectionRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): ServiceConnectionRow | null {
    const row = this.db.prepare('SELECT * FROM service_connections WHERE id = ?').get(id) as SqliteServiceConnectionRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  findByWorkspaceAdapterHost(workspaceId: string, adapterId: string, host: string): ServiceConnectionRow | null {
    const row = this.db
      .prepare('SELECT * FROM service_connections WHERE workspace_id = ? AND adapter_id = ? AND host = ?')
      .get(workspaceId, adapterId, host) as SqliteServiceConnectionRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  listByWorkspace(workspaceId: string): ServiceConnectionRow[] {
    const rows = this.db.prepare('SELECT * FROM service_connections WHERE workspace_id = ?').all(workspaceId) as SqliteServiceConnectionRow[];
    return rows.map(fromSqlite);
  }

  /** Upserts by (workspace_id, adapter_id, host) — one connection row per workspace/adapter/host, never a silent duplicate. */
  upsert(input: NewServiceConnectionRow): ServiceConnectionRow {
    const existing = this.findByWorkspaceAdapterHost(input.workspaceId, input.adapterId, input.host);
    if (existing) {
      this.db
        .prepare(
          `UPDATE service_connections
           SET account_label = ?, profile_label = ?, secret_ref_id = ?, state = ?, last_verified_at = ?
           WHERE id = ?`,
        )
        .run(input.accountLabel, input.profileLabel, input.secretRefId, input.state, input.lastVerifiedAt, existing.id);
      const updated = this.findById(existing.id);
      if (!updated) {
        throw new Error(`ServiceConnection ${existing.id} vanished during update`);
      }
      return updated;
    }
    this.db
      .prepare(
        `INSERT INTO service_connections (id, workspace_id, adapter_id, host, account_label, profile_label, secret_ref_id, state, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.adapterId,
        input.host,
        input.accountLabel,
        input.profileLabel,
        input.secretRefId,
        input.state,
        input.lastVerifiedAt,
      );
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`ServiceConnection ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM service_connections WHERE id = ?').run(id);
  }
}
