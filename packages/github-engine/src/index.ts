/**
 * @space/github-engine
 *
 * The GitHub CLI (gh) adapter and GitHub domain models (spec section 14).
 * GitHub CLI is the primary GitHub integration in V1 — this package must
 * not depend on a hypothetical GitHub CLI workspace feature.
 *
 * Built in M6 (Phase 5: GitHub workflow), with the section 5.6 credential
 * fallback design implemented per ADR-002.
 */
export * from './executor';
export * from './node-gh-executor';
export * from './json';
export * from './auth';
export * from './setup-git';
export * from './repository';
export * from './pull-requests';
export * from './checks';
export * from './workflow-metadata';
export * from './actions';
export * from './issues';
