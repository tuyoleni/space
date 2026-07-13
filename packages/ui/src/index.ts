/**
 * @space/ui
 *
 * Shared renderer components (presentation only). Must not import Node
 * core modules, perform IPC calls directly, or contain business logic
 * (spec section 33) — components receive data and callbacks as props.
 *
 * `relative-time.ts` is pure formatting logic (spec 28's "relative times
 * expose exact accessible labels") deliberately kept dependency-free of
 * React/JSX so it stays testable under this repo's Node-only test runner;
 * the renderer itself does the actual `<time>` markup with it.
 */
export * from './relative-time';
