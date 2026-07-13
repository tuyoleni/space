/**
 * Log rotation and bounded retention (spec 29.3: "Production logs need
 * rotation and bounded retention"). Pure decision functions — the same
 * "compute a plan, caller applies it against a real filesystem" shape
 * `@space/environment`'s `download-cache.ts` already establishes for its
 * own resource limit, so both are reviewable/testable without touching a
 * real disk.
 */

/** Bytes a single log file may reach before the next write rotates it (spec 27.4-style concrete resource limit). */
export const DEFAULT_MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;

/** Number of rotated log files retained at once, oldest deleted first (spec 29.3's "bounded retention"). */
export const DEFAULT_MAX_RETAINED_LOG_FILES = 10;

export interface LogFileStat {
  readonly name: string;
  readonly sizeBytes: number;
  /** epoch milliseconds */
  readonly createdAtMs: number;
}

/** True when the currently-active log file has grown past the limit and the next write should go to a new file instead. */
export function shouldRotate(currentFileSizeBytes: number, maxFileBytes: number = DEFAULT_MAX_LOG_FILE_BYTES): boolean {
  return currentFileSizeBytes >= maxFileBytes;
}

export interface RetentionPlan {
  readonly toDelete: readonly string[];
}

/**
 * Given every rotated (non-active) log file, decides which ones to delete
 * to stay within `maxRetainedFiles` — oldest first, never more than
 * necessary. The currently-active file is never in `rotatedFiles`; callers
 * pass only already-rotated ones.
 */
export function planLogRetention(rotatedFiles: readonly LogFileStat[], maxRetainedFiles: number = DEFAULT_MAX_RETAINED_LOG_FILES): RetentionPlan {
  if (rotatedFiles.length <= maxRetainedFiles) {
    return { toDelete: [] };
  }
  const oldestFirst = [...rotatedFiles].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const excess = oldestFirst.length - maxRetainedFiles;
  return { toDelete: oldestFirst.slice(0, excess).map((file) => file.name) };
}
