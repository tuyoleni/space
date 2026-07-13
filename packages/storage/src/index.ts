/**
 * @space/storage
 *
 * SQLite-backed repositories and versioned migrations behind a
 * data-access abstraction (spec section 23). Native module access runs in
 * a dedicated worker process only — never imported into the renderer
 * bundle, and never accessed directly from React hooks (spec section 33).
 *
 * Driver choice recorded in ADR-003.
 */
export * from './storage';
export * from './migrations';
export * from './repositories/workspace-repository';
export * from './repositories/project-repository';
export * from './repositories/operation-repository';
export * from './repositories/bootstrap-repository';
export * from './repositories/terminal-session-repository';
export * from './repositories/dev-process-repository';
export * from './repositories/activity-repository';
export * from './repositories/secret-ref-repository';
export * from './repositories/service-connection-repository';
export * from './repositories/agent-permission-repository';
export * from './receipts';
