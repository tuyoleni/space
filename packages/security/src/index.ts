/**
 * @space/security
 *
 * IPC sender validation (spec sections 20.3, 22.1, 25). This package is
 * the enforcement point for every "MUST NOT" boundary in the threat
 * model — changes here require reviewer approval from an assigned owner
 * (spec section 33). Secret redaction lives in @space/workspace-runner;
 * permission/risk-confirmation policy lands with the risk-classified
 * operations that need it.
 */
export * from './sender';
