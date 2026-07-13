import type Database from 'better-sqlite3';

interface SqliteAutomationSettingsRow {
  workspace_id: string;
  all_enabled: number;
  updated_at: string;
}

/**
 * The instant, per-workspace automation kill switch (spec 18.4: "a user
 * can disable all automations immediately"). Absence of a row means
 * automations are enabled by default — a workspace only ever gets a row
 * once someone actually flips the switch.
 */
export class AutomationSettingsRepository {
  constructor(private readonly db: Database.Database) {}

  isAllEnabled(workspaceId: string): boolean {
    const row = this.db
      .prepare('SELECT * FROM automation_settings WHERE workspace_id = ?')
      .get(workspaceId) as SqliteAutomationSettingsRow | undefined;
    return row ? row.all_enabled === 1 : true;
  }

  setAllEnabled(workspaceId: string, enabled: boolean, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO automation_settings (workspace_id, all_enabled, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET all_enabled = excluded.all_enabled, updated_at = excluded.updated_at`,
      )
      .run(workspaceId, enabled ? 1 : 0, updatedAt);
  }
}
