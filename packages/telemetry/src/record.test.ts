import { describe, expect, it, vi } from 'vitest';
import { recordTelemetryEvent } from './record';
import { DEFAULT_TELEMETRY_SETTINGS } from './settings';
import type { TelemetryEvent } from './schema';
import type { TelemetrySinkPort } from './sink';

function fakeSink(): TelemetrySinkPort & { sent: TelemetryEvent[] } {
  const sent: TelemetryEvent[] = [];
  return { sent, send: vi.fn(async (event: TelemetryEvent) => void sent.push(event)) };
}

const event: TelemetryEvent = { category: 'feature_usage', feature: 'workspace_created', occurredAt: '2026-07-13T00:00:00.000Z' };

describe('recordTelemetryEvent (spec 29.2: opt-in, default OFF)', () => {
  it('never calls the sink when telemetry is off (the default)', async () => {
    const sink = fakeSink();
    await recordTelemetryEvent(sink, DEFAULT_TELEMETRY_SETTINGS, event);
    expect(sink.send).not.toHaveBeenCalled();
    expect(sink.sent).toHaveLength(0);
  });

  it('calls the sink once explicitly opted in', async () => {
    const sink = fakeSink();
    await recordTelemetryEvent(sink, { enabled: true }, event);
    expect(sink.sent).toEqual([event]);
  });

  it('DEFAULT_TELEMETRY_SETTINGS is off', () => {
    expect(DEFAULT_TELEMETRY_SETTINGS.enabled).toBe(false);
  });
});
