import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_CRASH_CATEGORIES,
  TELEMETRY_FEATURES,
  TELEMETRY_INSTALLER_OUTCOMES,
  TELEMETRY_INSTALLER_TOOLS,
  TELEMETRY_PERFORMANCE_METRICS,
  TELEMETRY_PLATFORMS,
  type TelemetryEvent,
} from './schema';

describe('TelemetryEvent (spec 29.2: schema structurally excludes prohibited data)', () => {
  it('every enum is a non-empty closed set (no field is an open string)', () => {
    for (const set of [TELEMETRY_FEATURES, TELEMETRY_PERFORMANCE_METRICS, TELEMETRY_CRASH_CATEGORIES, TELEMETRY_INSTALLER_TOOLS, TELEMETRY_PLATFORMS, TELEMETRY_INSTALLER_OUTCOMES]) {
      expect(set.length).toBeGreaterThan(0);
    }
  });

  it('a well-formed event of every category constructs (compile-time proof the schema accepts real data)', () => {
    const events: TelemetryEvent[] = [
      { category: 'feature_usage', feature: 'git_commit', occurredAt: '2026-07-13T00:00:00.000Z' },
      { category: 'performance_timing', metric: 'app_startup', durationMs: 812, occurredAt: '2026-07-13T00:00:00.000Z' },
      { category: 'crash', crashCategory: 'renderer_crash', occurredAt: '2026-07-13T00:00:00.000Z' },
      { category: 'installer_outcome', tool: 'git', platform: 'darwin', outcome: 'succeeded', occurredAt: '2026-07-13T00:00:00.000Z' },
    ];
    expect(events).toHaveLength(4);
  });

  it('compile-time proof: an arbitrary free-form string cannot be smuggled into any field', () => {
    const notAFeature = 'rm -rf / #malicious-command-or-file-path';
    // @ts-expect-error — `feature` only accepts the closed TelemetryFeature union, not an arbitrary string (e.g. a file path, command, or secret value).
    const rejected: TelemetryEvent = { category: 'feature_usage', feature: notAFeature, occurredAt: '2026-07-13T00:00:00.000Z' };
    expect(rejected).toBeDefined();
  });

  it('compile-time proof: there is no free-form "message"/"context"/"path" field on any event variant', () => {
    // @ts-expect-error — TelemetryEvent has no variant with an open-ended `message` field at all.
    const rejected: TelemetryEvent = { category: 'feature_usage', feature: 'git_commit', occurredAt: '2026-07-13T00:00:00.000Z', message: 'commit message here' };
    expect(rejected).toBeDefined();
  });
});
