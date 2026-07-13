/**
 * @space/logging
 *
 * Structured logging (levels, correlation IDs, redaction), rotation and
 * bounded retention, and support-bundle preview/export — spec section
 * 29.3. Added M8 (Phase 7: automation and hardening).
 *
 * Never imported into the renderer bundle (spec section 32): it depends
 * on `@space/workspace-runner` for redaction, one of the packages the
 * README's package-layout table already forbids in the renderer.
 */
export * from './logger';
export * from './rotation';
export * from './support-bundle';
