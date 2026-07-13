/**
 * The beta telemetry event schema (spec 29.2). Every field in every event
 * variant below is either a closed string-literal union, a number, or an
 * ISO timestamp — there is no free-form string field anywhere in this
 * module. That is deliberate and load-bearing: spec 29.2 requires the
 * *schema itself* to be incapable of holding source code, commit
 * messages, unsanitized file paths, terminal text, tokens/environment
 * values, or private repository names — not just a caller convention that
 * a reviewer has to trust. A caller cannot pass an arbitrary string into
 * any of these fields; TypeScript rejects anything outside the literal
 * union at compile time, and there is no field shaped like `message:
 * string` or `context: Record<string, unknown>` for a caller to smuggle
 * one through even by mistake.
 */

export const TELEMETRY_FEATURES = [
  'workspace_created',
  'workspace_switched',
  'project_added',
  'project_created_from_template',
  'project_cloned',
  'project_trusted',
  'terminal_created',
  'dev_server_started',
  'git_commit',
  'git_push',
  'git_pull',
  'git_branch_created',
  'github_repository_published',
  'github_pull_request_created',
  'github_pull_request_merged',
  'github_release_published',
  'agent_commit_composed',
  'agent_intent_generated',
  'automation_created',
  'automation_run_completed',
  'support_bundle_exported',
] as const;
export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number];

export const TELEMETRY_PERFORMANCE_METRICS = [
  'app_startup',
  'git_status_refresh',
  'git_history_load',
  'terminal_create',
  'workspace_switch',
] as const;
export type TelemetryPerformanceMetric = (typeof TELEMETRY_PERFORMANCE_METRICS)[number];

export const TELEMETRY_CRASH_CATEGORIES = [
  'renderer_crash',
  'main_process_exception',
  'storage_worker_crash',
  'terminal_worker_crash',
  'native_module_load_failure',
  'unhandled_rejection',
] as const;
export type TelemetryCrashCategory = (typeof TELEMETRY_CRASH_CATEGORIES)[number];

/** Deliberately narrower than @space/environment's manifest-driven `toolId: string` — a closed, telemetry-owned enum so this schema's safety never depends on how that other package happens to be configured. */
export const TELEMETRY_INSTALLER_TOOLS = ['git', 'gh', 'node', 'npm', 'volta', 'homebrew', 'winget'] as const;
export type TelemetryInstallerTool = (typeof TELEMETRY_INSTALLER_TOOLS)[number];

export const TELEMETRY_PLATFORMS = ['darwin', 'win32'] as const;
export type TelemetryPlatform = (typeof TELEMETRY_PLATFORMS)[number];

export const TELEMETRY_INSTALLER_OUTCOMES = ['succeeded', 'failed'] as const;
export type TelemetryInstallerOutcome = (typeof TELEMETRY_INSTALLER_OUTCOMES)[number];

export type TelemetryEvent =
  | { readonly category: 'feature_usage'; readonly feature: TelemetryFeature; readonly occurredAt: string }
  | { readonly category: 'performance_timing'; readonly metric: TelemetryPerformanceMetric; readonly durationMs: number; readonly occurredAt: string }
  | { readonly category: 'crash'; readonly crashCategory: TelemetryCrashCategory; readonly occurredAt: string }
  | {
      readonly category: 'installer_outcome';
      readonly tool: TelemetryInstallerTool;
      readonly platform: TelemetryPlatform;
      readonly outcome: TelemetryInstallerOutcome;
      readonly occurredAt: string;
    };

export type TelemetryEventCategory = TelemetryEvent['category'];
