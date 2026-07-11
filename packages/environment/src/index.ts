/**
 * @space/environment
 *
 * Tool registry, onboarding installers, and workspace service adapters
 * (spec sections 8, 16). Every adapter declares an explicit isolation tier
 * (1-4, spec section 5.5) and must not receive renderer objects or
 * unvalidated free-form commands.
 *
 * Populated during M3 (Phase 2: computer bootstrap) and extended in later
 * phases as new service adapters are added.
 */
export {};
