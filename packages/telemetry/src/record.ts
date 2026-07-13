/**
 * The one call every telemetry-producing call site in this codebase would
 * go through (spec 29.2) — checks the opt-in setting before ever touching
 * the sink, so "telemetry is off by default" is enforced here structurally
 * rather than trusted to every individual call site remembering to check.
 */
import { shouldSendTelemetry, type TelemetrySettings } from './settings';
import type { TelemetryEvent } from './schema';
import type { TelemetrySinkPort } from './sink';

export async function recordTelemetryEvent(sink: TelemetrySinkPort, settings: TelemetrySettings, event: TelemetryEvent): Promise<void> {
  if (!shouldSendTelemetry(settings)) {
    return;
  }
  await sink.send(event);
}
