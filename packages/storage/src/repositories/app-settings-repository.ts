import type Database from 'better-sqlite3';

interface SqliteAppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

const TELEMETRY_ENABLED_KEY = 'telemetry.enabled';

/**
 * App-level (not per-workspace) settings — a plain key/value store so
 * future flags never need a schema migration just to add one more
 * setting. `telemetryEnabled` (spec 29.2's opt-in, default OFF) is the
 * first and only key this milestone actually reads/writes; the generic
 * `get`/`set` beneath it exists so the next app-level setting (e.g. a
 * deferred-update version, spec 31.3) reuses this table rather than
 * getting its own.
 */
export class AppSettingsRepository {
  constructor(private readonly db: Database.Database) {}

  private get(key: string): string | null {
    const row = this.db.prepare('SELECT * FROM app_settings WHERE key = ?').get(key) as SqliteAppSettingRow | undefined;
    return row ? row.value : null;
  }

  private set(key: string, value: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, updatedAt);
  }

  /** Absence of a row means telemetry is OFF (spec 29.2's default) — a fresh install never has this row until a user explicitly opts in. */
  isTelemetryEnabled(): boolean {
    return this.get(TELEMETRY_ENABLED_KEY) === 'true';
  }

  setTelemetryEnabled(enabled: boolean, updatedAt: string): void {
    this.set(TELEMETRY_ENABLED_KEY, enabled ? 'true' : 'false', updatedAt);
  }
}
