/**
 * @space/storage
 *
 * SQLite-backed repositories and versioned migrations behind a
 * data-access abstraction (spec section 23). Native module access runs in
 * a dedicated worker process only — never imported into the renderer
 * bundle, and never accessed directly from React hooks (spec section 33).
 *
 * Populated during M2 (secure application foundation); driver choice
 * recorded in ADR-003.
 */
export {};
