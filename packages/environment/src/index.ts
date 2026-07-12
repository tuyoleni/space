/**
 * @space/environment
 *
 * Tool registry, onboarding installers, and workspace service adapters
 * (spec sections 8, 16). Every adapter declares an explicit isolation tier
 * (1-4, spec section 5.5) and must not receive renderer objects or
 * unvalidated free-form commands.
 *
 * M3 (Phase 2: computer bootstrap) populated the bootstrap manifest,
 * non-mutating scan, macOS/Windows install plans, verification, and the
 * step/state-machine orchestration (spec section 8). Workspace service
 * adapters (spec section 16.4) are extended in later phases.
 */
export * from './types';
export * from './manifest';
export * from './version';
export * from './scan';
export * from './node-adapters';
export * from './homebrew';
export * from './winget';
export * from './macos-plan';
export * from './windows-plan';
export * from './verify';
export * from './orchestrator';
export * from './bootstrap-state';
export * from './project-detection';
export * from './package-manager';
export * from './project-templates';
