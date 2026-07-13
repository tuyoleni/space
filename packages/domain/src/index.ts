/**
 * @space/domain
 *
 * Pure models and policies (environment precedence, risk classification,
 * trust rules, etc.) shared across privileged packages. No I/O, no
 * Electron/Node imports — everything here must be unit-testable in
 * isolation with plain fixtures.
 *
 * Populated during M2 (secure application foundation); project trust
 * policy (spec 10.3, ADR-006) added in M4; the destructive Git action
 * confirmation gate (spec 11.9/11.10) added in M5; the high-impact GitHub
 * action confirmation gate (spec 14.6/14.10) added in M6; the agent-action
 * confirmation gate (spec 19.2, 25.3.6) added in M7.
 */
export * from './environment';
export * from './trust';
export * from './git-confirmation';
export * from './github-confirmation';
export * from './agent-confirmation';
