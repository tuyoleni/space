/**
 * @space/telemetry
 *
 * Opt-in (default OFF) beta telemetry (spec section 29.2). Added M8
 * (Phase 7: automation and hardening).
 *
 * - `schema.ts`: the closed event schema — structurally incapable of
 *   holding source code, commit messages, file paths, terminal text,
 *   tokens, or private repo names, not just by caller convention.
 * - `settings.ts`: the opt-in flag, defaulting OFF.
 * - `sink.ts`: the DI'd, fake-only `TelemetrySinkPort` seam — no real
 *   telemetry backend exists yet (hard safety boundary for this
 *   milestone).
 * - `record.ts`: the one gated entry point every call site uses.
 */
export * from './schema';
export * from './settings';
export * from './sink';
export * from './record';
