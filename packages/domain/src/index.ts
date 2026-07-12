/**
 * @space/domain
 *
 * Pure models and policies (environment precedence, risk classification,
 * trust rules, etc.) shared across privileged packages. No I/O, no
 * Electron/Node imports — everything here must be unit-testable in
 * isolation with plain fixtures.
 *
 * Populated during M2 (secure application foundation).
 */
export * from './environment';
