/**
 * Real, local-only file-backed logging (spec 29.3) — the one concrete
 * `LogSink` for `@space/logging`'s injected-everything `createLogger`.
 * Every log line is appended to a single active file under
 * `<userData>/logs`; once it grows past `DEFAULT_MAX_LOG_FILE_BYTES` the
 * next write rotates to a fresh timestamped file and
 * `planLogRetention` deletes the oldest rotated files beyond
 * `DEFAULT_MAX_RETAINED_LOG_FILES` — both real Node `fs` calls applying
 * `@space/logging`'s pure decisions, not just documentation.
 *
 * Never sends anything anywhere: no network call exists in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createLogger,
  planLogRetention,
  shouldRotate,
  type LogEntry,
  type LogFileStat,
  type LogSink,
  type Logger,
} from '@space/logging';

const ACTIVE_LOG_FILE_NAME = 'space.log';
const ROTATED_LOG_FILE_PATTERN = /^space-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.log$/;

function rotatedFileNameFor(now: Date): string {
  return `space-${now.toISOString().replace(/[:.]/g, '-')}.log`;
}

function listRotatedLogFiles(logsDir: string): LogFileStat[] {
  if (!fs.existsSync(logsDir)) {
    return [];
  }
  return fs
    .readdirSync(logsDir)
    .filter((name) => ROTATED_LOG_FILE_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(logsDir, name));
      return { name, sizeBytes: stat.size, createdAtMs: stat.birthtimeMs || stat.ctimeMs };
    });
}

/** A real `LogSink` writing newline-delimited JSON to `<logsDir>/space.log`, rotating and pruning on every write. */
export class FileLogSink implements LogSink {
  constructor(private readonly logsDir: string) {
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  private activeFilePath(): string {
    return path.join(this.logsDir, ACTIVE_LOG_FILE_NAME);
  }

  write(entry: LogEntry): void {
    const activeFilePath = this.activeFilePath();
    const currentSize = fs.existsSync(activeFilePath) ? fs.statSync(activeFilePath).size : 0;

    if (shouldRotate(currentSize)) {
      fs.renameSync(activeFilePath, path.join(this.logsDir, rotatedFileNameFor(new Date())));
      const plan = planLogRetention(listRotatedLogFiles(this.logsDir));
      for (const name of plan.toDelete) {
        fs.rmSync(path.join(this.logsDir, name), { force: true });
      }
    }

    fs.appendFileSync(activeFilePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }
}

/** Real logger for the main process, backed by `FileLogSink`. `minLevel` defaults to 'info' in packaged builds and 'debug' in dev, so local development sees everything without needing to flip a setting. */
export function createAppLogger(logsDir: string, isPackaged: boolean): Logger {
  return createLogger({ sink: new FileLogSink(logsDir), minLevel: isPackaged ? 'info' : 'debug' });
}
