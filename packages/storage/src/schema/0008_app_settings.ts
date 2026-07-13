/**
 * App-level (not per-workspace) settings, added M8. Additive migration
 * (ADR-003): never edit 0001-0007 once shipped. `app_settings` is a plain
 * key/value table rather than dedicated columns, so future app-level
 * settings (spec 29.2's telemetry opt-in is the first) never need another
 * migration just to add one more flag — the same reasoning
 * `automation_settings` documents for staying a dedicated row rather than
 * a column elsewhere, applied one level more generically since this table
 * is not workspace-scoped at all.
 */
export const MIGRATION_0008_APP_SETTINGS = `
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
