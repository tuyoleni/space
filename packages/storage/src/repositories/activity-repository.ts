import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ActivityEvent, ActivityEventType, NewActivityEvent } from '@space/activity';

interface SqliteActivityEventRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  event_type: string;
  occurred_at: string;
  subject_ref: string | null;
  summary: string;
  weight: number;
  metadata_json: string | null;
}

function fromSqlite(row: SqliteActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    eventType: row.event_type as ActivityEventType,
    occurredAt: row.occurred_at,
    subjectRef: row.subject_ref,
    summary: row.summary,
    weight: row.weight,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
  };
}

export interface ActivityDateRange {
  readonly fromInclusive: string;
  readonly toInclusive: string;
}

/**
 * Days of activity history retained before `pruneOlderThan` removes a row
 * (spec 27.4's resource-limit requirement, spec 17.4 "activity is local by
 * default"). Kept in lockstep with `@space/domain`'s `RESOURCE_LIMITS.
 * activityRetentionDays` by convention, not by importing it (this package
 * stays dependency-light on purpose).
 */
export const ACTIVITY_RETENTION_DAYS = 400;

/**
 * Pure data access over `activity_events` (spec 23.2.9). Every row here
 * traces back to `@space/activity`'s `activityEventFromOperation` or a
 * direct observed-state recording call — this repository never invents
 * rows itself (spec 17.1 ACT-001).
 */
export class ActivityRepository {
  constructor(private readonly db: Database.Database) {}

  record(input: NewActivityEvent): ActivityEvent {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO activity_events
           (id, workspace_id, project_id, event_type, occurred_at, subject_ref, summary, weight, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.projectId,
        input.eventType,
        input.occurredAt,
        input.subjectRef,
        input.summary,
        input.weight,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
    const row = this.db.prepare('SELECT * FROM activity_events WHERE id = ?').get(id) as
      | SqliteActivityEventRow
      | undefined;
    if (!row) {
      throw new Error(`Activity event ${id} was inserted but could not be re-read`);
    }
    return fromSqlite(row);
  }

  listByWorkspaceInRange(workspaceId: string, range: ActivityDateRange): ActivityEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_events
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at <= ?
         ORDER BY occurred_at ASC`,
      )
      .all(workspaceId, range.fromInclusive, range.toInclusive) as SqliteActivityEventRow[];
    return rows.map(fromSqlite);
  }

  /** Deletes every event older than `ACTIVITY_RETENTION_DAYS` (spec 27.4) — a bounded, tested retention window, not just documentation. Returns the number of rows removed. */
  pruneOlderThan(cutoffIso: string): number {
    const result = this.db.prepare('DELETE FROM activity_events WHERE occurred_at < ?').run(cutoffIso);
    return result.changes;
  }
}
