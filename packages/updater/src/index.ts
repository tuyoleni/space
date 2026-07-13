/**
 * @space/updater
 *
 * Client-side auto-update logic (spec section 31.3). Added M8 (Phase 7:
 * automation and hardening).
 *
 * - `update-feed.ts`: the DI'd, fake-only `UpdateFeedPort` seam — no real
 *   update server exists yet (hard safety boundary for this milestone).
 * - `signature.ts`: real cryptographic verification of a downloaded
 *   artifact against an injected public key.
 * - `apply-gate.ts`: the structural "never interrupt a running
 *   installation/Git mutation/unrecoverable operation, and never apply on
 *   top of already-pending local migrations" gate.
 * - `decision.ts`: defer/restart-later as an explicit state machine.
 * - `release-channel.ts`: spec 31.4's four channels.
 *
 * Rollback policy (spec 31.3: "Maintain a documented rollback policy;
 * app binary rollback may not imply database rollback") is documented in
 * ADR-009, not encoded here — it is a decision record, not executable
 * logic this package could enforce (the SQLite migrations this app runs
 * are additive-only and forward-only, per ADR-003; there is no automatic
 * schema-rollback path, so the policy is "an app-binary downgrade is safe
 * to offer; a database downgrade is never attempted automatically").
 */
export * from './update-feed';
export * from './release-channel';
export * from './signature';
export * from './apply-gate';
export * from './decision';
