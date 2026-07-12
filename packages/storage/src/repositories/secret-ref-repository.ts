import type Database from 'better-sqlite3';

/**
 * Pure data access over the `secret_refs` table (spec 23.2.6). This row
 * never has, and must never gain, a column for the secret value itself —
 * only enough to look the real value up in the OS credential store via
 * `@space/security`'s `CredentialStorePort` (`service_name`/`account_key`
 * map 1:1 onto a `CredentialRef`).
 */
export interface SecretRefRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly serviceName: string;
  readonly accountKey: string;
  readonly createdAt: string;
}

export interface NewSecretRefRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly serviceName: string;
  readonly accountKey: string;
  readonly createdAt: string;
}

interface SqliteSecretRefRow {
  id: string;
  workspace_id: string;
  provider: string;
  service_name: string;
  account_key: string;
  created_at: string;
}

function fromSqlite(row: SqliteSecretRefRow): SecretRefRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    serviceName: row.service_name,
    accountKey: row.account_key,
    createdAt: row.created_at,
  };
}

export class SecretRefRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): SecretRefRow | null {
    const row = this.db.prepare('SELECT * FROM secret_refs WHERE id = ?').get(id) as SqliteSecretRefRow | undefined;
    return row ? fromSqlite(row) : null;
  }

  findByServiceAccount(serviceName: string, accountKey: string): SecretRefRow | null {
    const row = this.db.prepare('SELECT * FROM secret_refs WHERE service_name = ? AND account_key = ?').get(serviceName, accountKey) as
      | SqliteSecretRefRow
      | undefined;
    return row ? fromSqlite(row) : null;
  }

  /** Idempotent by (service_name, account_key): returns the existing row rather than creating a duplicate reference to the same keychain entry. */
  create(input: NewSecretRefRow): SecretRefRow {
    const existing = this.findByServiceAccount(input.serviceName, input.accountKey);
    if (existing) {
      return existing;
    }
    this.db
      .prepare(
        `INSERT INTO secret_refs (id, workspace_id, provider, service_name, account_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.workspaceId, input.provider, input.serviceName, input.accountKey, input.createdAt);
    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`SecretRef ${input.id} was inserted but could not be re-read`);
    }
    return created;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM secret_refs WHERE id = ?').run(id);
  }
}
