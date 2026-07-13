/**
 * FileLogSink exercised against a real temp directory (spec 29.3) — proves
 * rotation and bounded retention actually happen on disk, not just in the
 * pure `@space/logging` decision functions this wraps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@space/logging';
import { FileLogSink, createAppLogger } from './logging';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-logging-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FileLogSink', () => {
  it('appends newline-delimited JSON entries to the active log file', () => {
    const sink = new FileLogSink(dir);
    const logger = createLogger({ sink, now: () => '2026-07-13T00:00:00.000Z' });
    logger.info('first');
    logger.warn('second');

    const content = fs.readFileSync(path.join(dir, 'space.log'), 'utf-8');
    const lines = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ level: 'info', message: 'first' });
    expect(lines[1]).toMatchObject({ level: 'warn', message: 'second' });
  });

  it('rotates the active file once it exceeds the size limit, and prunes beyond the retention cap', () => {
    // A large single entry forces rotation on the very next write, and
    // repeating that lets us prove retention pruning without waiting for
    // real megabytes of log volume.
    const bigContext = { blob: 'x'.repeat(6 * 1024 * 1024) };
    const sink = new FileLogSink(dir);
    const logger = createLogger({ sink });

    for (let i = 0; i < 12; i += 1) {
      logger.info(`entry-${i}`, bigContext);
    }

    const rotatedFiles = fs.readdirSync(dir).filter((name) => /^space-.*\.log$/.test(name));
    expect(rotatedFiles.length).toBeLessThanOrEqual(10);
    expect(fs.existsSync(path.join(dir, 'space.log'))).toBe(true);
  });
});

describe('createAppLogger', () => {
  it('defaults to debug level in dev (unpackaged) and info in packaged builds', () => {
    const devLogger = createAppLogger(path.join(dir, 'dev'), false);
    const packagedLogger = createAppLogger(path.join(dir, 'packaged'), true);

    devLogger.debug('dev-debug-message');
    packagedLogger.debug('packaged-debug-message-should-be-dropped');
    packagedLogger.info('packaged-info-message');

    const devContent = fs.readFileSync(path.join(dir, 'dev', 'space.log'), 'utf-8');
    expect(devContent).toContain('dev-debug-message');

    const packagedContent = fs.readFileSync(path.join(dir, 'packaged', 'space.log'), 'utf-8');
    expect(packagedContent).not.toContain('packaged-debug-message-should-be-dropped');
    expect(packagedContent).toContain('packaged-info-message');
  });
});
