/**
 * ServiceConnection and SecretRef (spec 23.2.5/23.2.6, ADR-002). Additive
 * migration (ADR-003): never edit 0001-0004 once shipped.
 *
 * `secret_refs` is deliberately narrow: it never has a column for the
 * secret value itself (spec 23.2.6: "the secret value itself is not
 * stored in SQLite"; spec 39: never store tokens in SQLite or plain
 * JSON). Real GitHub tokens live only in the OS credential store,
 * addressed by `service_name`/`account_key` — see
 * `@space/security`'s `CredentialStorePort`.
 */
export const MIGRATION_0005_GITHUB = `
CREATE TABLE secret_refs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  service_name TEXT NOT NULL,
  account_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_secret_refs_workspace_id ON secret_refs(workspace_id);
CREATE UNIQUE INDEX idx_secret_refs_service_account ON secret_refs(service_name, account_key);

CREATE TABLE service_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  host TEXT NOT NULL,
  account_label TEXT,
  profile_label TEXT,
  secret_ref_id TEXT REFERENCES secret_refs(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'disconnected',
  last_verified_at TEXT
);
CREATE INDEX idx_service_connections_workspace_id ON service_connections(workspace_id);
CREATE UNIQUE INDEX idx_service_connections_workspace_adapter_host ON service_connections(workspace_id, adapter_id, host);
`;
