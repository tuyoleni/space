import { describe, expect, it } from 'vitest';
import { createLogger, type LogEntry, type LogSink } from './logger';

function fakeSink(): LogSink & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, write: (entry) => entries.push(entry) };
}

describe('createLogger (spec 29.3: levels, correlation IDs, redaction)', () => {
  it('stamps every entry with level, timestamp, and a null correlation id by default', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink, now: () => '2026-07-13T00:00:00.000Z' });
    logger.info('hello');
    expect(sink.entries).toEqual([{ timestamp: '2026-07-13T00:00:00.000Z', level: 'info', correlationId: null, message: 'hello' }]);
  });

  it('withCorrelationId stamps every subsequent entry from the returned logger, and only that one', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink, now: () => '2026-07-13T00:00:00.000Z' });
    const scoped = logger.withCorrelationId('op-123');
    scoped.warn('scoped message');
    logger.info('unscoped message');
    expect(sink.entries[0]).toMatchObject({ correlationId: 'op-123', message: 'scoped message' });
    expect(sink.entries[1]).toMatchObject({ correlationId: null, message: 'unscoped message' });
  });

  it('drops entries below minLevel before they ever reach the sink', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink, minLevel: 'warn' });
    logger.debug('dropped');
    logger.info('also dropped');
    logger.warn('kept');
    logger.error('kept too');
    expect(sink.entries.map((e) => e.message)).toEqual(['kept', 'kept too']);
  });

  it('redacts secret-shaped values in the message before they reach the sink', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    logger.error('token leaked: ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8');
    expect(sink.entries[0]?.message).toBe('token leaked: [REDACTED]');
  });

  it('redacts secret-shaped string values inside context, leaving non-string values untouched', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    logger.info('operation finished', { token: 'ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8', exitCode: 0, ok: true });
    expect(sink.entries[0]?.context).toEqual({ token: '[REDACTED]', exitCode: 0, ok: true });
  });
});
