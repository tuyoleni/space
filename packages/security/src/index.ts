/**
 * @space/security
 *
 * IPC sender validation (spec sections 20.3, 22.1, 25). This package is
 * the enforcement point for every "MUST NOT" boundary in the threat
 * model — changes here require reviewer approval from an assigned owner
 * (spec section 33). Secret redaction lives in @space/workspace-runner;
 * permission/risk-confirmation policy lands with the risk-classified
 * operations that need it.
 *
 * M6 adds the credential store port (spec 5.6, 24.1): the OS keychain
 * abstraction every workspace GitHub token (and any future provider
 * secret) is read/written through, injected exactly like GitExecutor and
 * GhExecutor so it is testable without ever touching a real keychain.
 */
export * from './sender';
export * from './credential-store';
export * from './os-credential-executor';
export * from './keychain-credential-store';
