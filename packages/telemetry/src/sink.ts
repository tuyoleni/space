/**
 * The telemetry sink seam (spec 29.2). Injected, never a hard-coded
 * endpoint — Space does not operate a real telemetry/analytics backend
 * today; the hard safety boundary for this milestone requires this stay
 * fake-only in every test, and the caller (apps/desktop) is documented to
 * leave it unwired until a real backend decision is made — see ADR-009.
 */
import type { TelemetryEvent } from './schema';

export interface TelemetrySinkPort {
  send(event: TelemetryEvent): Promise<void>;
}
