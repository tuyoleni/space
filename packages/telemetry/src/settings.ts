/**
 * Opt-in telemetry settings (spec 29.2: "Telemetry must be opt-in or
 * clearly disclosed... default OFF" per this milestone's product policy
 * — see ADR-009). A dedicated, tiny settings shape rather than reusing
 * `@space/automation`'s kill-switch pattern verbatim, because the default
 * polarity is opposite (automations default *enabled*; telemetry defaults
 * *disabled*) and conflating the two would risk a copy-paste defaulting
 * bug in exactly the field that matters most here.
 */
export interface TelemetrySettings {
  readonly enabled: boolean;
}

/** The only place "OFF by default" is decided — every caller reads settings through this, never invents its own default. */
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = { enabled: false };

export function shouldSendTelemetry(settings: TelemetrySettings): boolean {
  return settings.enabled;
}
