/**
 * @space/domain
 *
 * Pure models and policies (environment precedence, risk classification,
 * trust rules, etc.) shared across privileged packages. No I/O, no
 * Electron/Node imports — everything here must be unit-testable in
 * isolation with plain fixtures.
 *
 * Populated during M2 (secure application foundation); project trust
 * policy (spec 10.3, ADR-006) added in M4.
 */
export * from './environment';
export * from './trust';
