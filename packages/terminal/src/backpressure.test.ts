import { describe, expect, it } from 'vitest';
import { BackpressureBuffer } from './backpressure';

describe('BackpressureBuffer', () => {
  it('flushes null when nothing has been pushed', () => {
    const buffer = new BackpressureBuffer({ maxBufferedBytes: 1024 });
    expect(buffer.flush()).toBeNull();
  });

  it('coalesces multiple pushes into a single flush', () => {
    const buffer = new BackpressureBuffer({ maxBufferedBytes: 1024 });
    buffer.push('hello ');
    buffer.push('world');
    expect(buffer.flush()).toEqual({ text: 'hello world', droppedBytes: 0 });
    expect(buffer.flush()).toBeNull();
  });

  it('caps buffered bytes and reports drops instead of growing unbounded', () => {
    const buffer = new BackpressureBuffer({ maxBufferedBytes: 10 });
    buffer.push('0123456789'); // exactly at the cap
    expect(buffer.pendingBytes).toBe(10);
    buffer.push('ABCDE'); // pushes 5 bytes past the cap
    expect(buffer.pendingBytes).toBeLessThanOrEqual(10);

    const flushed = buffer.flush();
    expect(flushed).not.toBeNull();
    expect(flushed?.droppedBytes).toBeGreaterThan(0);
    // The buffer always keeps the most recent data, dropping the oldest.
    expect(flushed?.text.endsWith('ABCDE')).toBe(true);
  });

  it('a noisy producer never grows the buffer past the configured cap', () => {
    const buffer = new BackpressureBuffer({ maxBufferedBytes: 64 });
    for (let i = 0; i < 10_000; i += 1) {
      buffer.push('x'.repeat(50));
    }
    expect(buffer.pendingBytes).toBeLessThanOrEqual(64);
  });
});
